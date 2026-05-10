# Design Document: postgres-runtime

## Overview

This design covers the local PostgreSQL runtime and Prisma integration for the ArcPass monorepo. The goal is to provide every developer with a one-command, reproducible database environment that works identically across machines.

The implementation spans three layers:

1. **Infrastructure layer** — Docker Compose service with healthcheck and persistent volume
2. **Data access layer** — Singleton PrismaClient, connection validation, and migration workflow in `packages/shared`
3. **Developer experience layer** — Root workspace scripts, `.env.example` files, and local development documentation

All database logic lives in `packages/shared`. Apps (`api`, `worker`) consume the shared Prisma client as a workspace dependency — they never instantiate their own `PrismaClient`.

## Architecture

```mermaid
graph TD
    subgraph "Developer Machine"
        subgraph "Docker Compose"
            PG[PostgreSQL 16 Alpine]
            VOL[(arcpass_pgdata volume)]
            PG --> VOL
        end

        subgraph "pnpm Workspace"
            ROOT[Root package.json<br/>db:up, db:down, db:migrate, etc.]
            SHARED["packages/shared<br/>PrismaClient singleton<br/>validateDatabaseUrl()<br/>schema.prisma"]
            API[apps/api<br/>imports @arcpass/shared]
            WORKER[apps/worker<br/>imports @arcpass/shared]
        end

        ROOT -->|docker compose up -d| PG
        ROOT -->|pnpm --filter @arcpass/shared| SHARED
        SHARED -->|DATABASE_URL| PG
        API -->|workspace dep| SHARED
        WORKER -->|workspace dep| SHARED
    end
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| PostgreSQL 16 Alpine | Smallest official image, LTS version, matches production target |
| Named volume over bind mount | Survives `docker compose down`, avoids filesystem permission issues on Linux/WSL |
| Singleton via `globalThis` | Prevents connection pool exhaustion during hot-reload in development |
| No hardcoded fallback URL | Forces explicit configuration, prevents silent connection to wrong database |
| `127.0.0.1` port binding | Prevents accidental network exposure of dev database |
| Validation before connection | Fails fast with actionable error messages instead of cryptic Prisma errors |
| Root workspace scripts | Single entry point for all db operations regardless of working directory |

## Components and Interfaces

### 1. Docker Compose Service (`docker-compose.yml` at repo root)

Defines the PostgreSQL container with healthcheck. Single service for MVP — no dependent app containers yet.

```yaml
# docker-compose.yml (root)
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_DB: arcpass_dev
      POSTGRES_USER: arcpass
      POSTGRES_PASSWORD: arcpass_local
    volumes:
      - arcpass_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U arcpass -d arcpass_dev"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

volumes:
  arcpass_pgdata:
```

### 2. Connection Validator (`packages/shared/src/db.ts`)

Enhances the existing `validateDatabaseUrl()` to include:
- Whitespace/empty check
- URL scheme validation (`postgresql://` or `postgres://`)
- Non-local host warning in non-production environments
- Connection reachability check via `prisma.$connect()`

```typescript
// Public interface
export function validateDatabaseUrl(): string
export async function validateConnection(): Promise<void>
export const prisma: PrismaClient
```

**`validateDatabaseUrl()`** — Synchronous. Validates format only. Throws if:
- `DATABASE_URL` is unset, empty, or whitespace-only
- `DATABASE_URL` does not start with `postgresql://` or `postgres://`

Logs a warning if `NODE_ENV !== 'production'` and host is not `localhost` or `127.0.0.1`.

**`validateConnection()`** — Async. Calls `validateDatabaseUrl()` then attempts `prisma.$connect()` with a 5-second timeout. Throws on connection failure with host/port in the error message.

**`prisma`** — Singleton PrismaClient instance, cached on `globalThis` in non-production to survive hot-reload.

### 3. Workspace Scripts (root `package.json`)

| Script | Command |
|--------|---------|
| `db:up` | `docker compose up -d` |
| `db:down` | `docker compose down` |
| `db:generate` | `pnpm --filter @arcpass/shared generate` |
| `db:migrate` | `pnpm --filter @arcpass/shared migrate:dev` |
| `db:reset` | `pnpm --filter @arcpass/shared db:reset` |
| `db:studio` | `pnpm --filter @arcpass/shared studio` |

### 4. Shared Package Scripts (`packages/shared/package.json`)

Adds to existing scripts:
| Script | Command |
|--------|---------|
| `studio` | `prisma studio` |
| `db:reset` | `prisma migrate reset` |

Existing scripts remain unchanged: `generate`, `build`, `migrate:dev`, `migrate:deploy`, `db:push`.

### 5. Environment Configuration

```
# .env.example (root and packages/shared)
# Prisma database connection string
# Format: postgresql://<user>:<password>@<host>:<port>/<database>?schema=<schema>
# This .env file must be loaded by the consuming application (apps/api, apps/worker).
# It is not auto-loaded by the Shared_Package.
DATABASE_URL=postgresql://arcpass:arcpass_local@localhost:5432/arcpass_dev?schema=public
```

### 6. Local Development Documentation (`docs/local-development.md`)

Structured as:
1. Prerequisites (Docker, Node.js, pnpm versions)
2. Setup steps (copy .env, db:up, db:migrate, db:generate, start apps)
3. Verification command
4. Troubleshooting (port conflicts, connection refused, migration conflicts, volume cleanup)

## Data Models

The Prisma schema is already defined in `packages/shared/prisma/schema.prisma`. No new models are introduced by this feature. The existing models are:

| Model | Purpose |
|-------|---------|
| `Wallet` | Tracks unique wallet addresses and eligibility state |
| `SponsorshipRequest` | Lifecycle of a sponsorship attempt |
| `RelayTransaction` | Blockchain relay execution tracking |
| `RateLimit` | Anti-abuse rate limiting infrastructure |

### Migration Storage

Migrations are stored at `packages/shared/prisma/migrations/` as timestamped directories containing:
- `migration.sql` — The SQL statements
- Prisma migration metadata

The initial migration will be created by running `pnpm db:migrate` after the Docker container is healthy.

### Connection String Format

```
postgresql://arcpass:arcpass_local@localhost:5432/arcpass_dev?schema=public
```

Components:
- **User**: `arcpass` (non-production credential)
- **Password**: `arcpass_local` (non-production credential)
- **Host**: `localhost` (bound to 127.0.0.1 only)
- **Port**: `5432` (standard PostgreSQL port)
- **Database**: `arcpass_dev` (clearly named as development)
- **Schema**: `public` (default PostgreSQL schema)

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Empty or whitespace DATABASE_URL is always rejected

*For any* string that is empty or composed entirely of whitespace characters (spaces, tabs, newlines, carriage returns), calling `validateDatabaseUrl()` with that value as `process.env.DATABASE_URL` SHALL throw an error whose message contains both the text "DATABASE_URL" and the expected format prefix "postgresql://".

**Validates: Requirements 3.3, 9.5, 11.1**

### Property 2: Invalid URL scheme is always rejected

*For any* non-empty string that does not begin with `postgresql://` or `postgres://`, calling `validateDatabaseUrl()` SHALL throw a format validation error before attempting any network connection, and the error message SHALL indicate the expected scheme.

**Validates: Requirements 11.4**

### Property 3: Non-local host warning in non-production environments

*For any* valid `DATABASE_URL` containing a host that is neither `localhost` nor `127.0.0.1`, when `NODE_ENV` is not set to `"production"` (including when `NODE_ENV` is undefined), the connection validator SHALL emit a warning message to stdout indicating that a non-local database host was detected. Conversely, *for any* valid `DATABASE_URL` containing `localhost` or `127.0.0.1` as the host, no such warning SHALL be emitted regardless of `NODE_ENV`.

**Validates: Requirements 12.3, 12.5**

## Error Handling

### Connection Validation Errors

| Condition | Error Type | Message Content | Behavior |
|-----------|-----------|-----------------|----------|
| `DATABASE_URL` unset/empty/whitespace | `Error` (thrown synchronously) | Contains "DATABASE_URL" and "postgresql://" format | Prevents PrismaClient instantiation |
| `DATABASE_URL` invalid scheme | `Error` (thrown synchronously) | Contains expected scheme "postgresql://" or "postgres://" | Prevents connection attempt |
| Database unreachable | `Error` (thrown from `validateConnection()`) | Contains host and port attempted | Thrown within 5-second timeout |
| Non-local host in non-production | Warning (console.warn) | Contains detected host value | Does NOT throw — logs warning only |

### Migration Errors

Prisma CLI handles migration errors natively:
- Schema conflicts → non-zero exit code, previously applied migrations remain intact
- Missing `DATABASE_URL` → non-zero exit code with descriptive error
- Connection failure → non-zero exit code

No custom error handling wraps Prisma CLI commands. The workspace scripts pass through Prisma's exit codes.

### Docker Healthcheck Failure

If PostgreSQL fails to become healthy within 5 retries (25 seconds total after start_period), Docker marks the container as `unhealthy`. Any service with `depends_on: { postgres: { condition: service_healthy } }` will not start. The developer sees the unhealthy status via `docker compose ps`.

## Testing Strategy

### Unit Tests (Vitest)

Unit tests verify specific examples and edge cases for the connection validation logic in `packages/shared`:

- `validateDatabaseUrl()` throws on undefined `DATABASE_URL`
- `validateDatabaseUrl()` throws on empty string
- `validateDatabaseUrl()` returns URL when valid
- `validateDatabaseUrl()` throws on `mysql://` scheme
- `validateConnection()` throws on unreachable host (mocked)
- Singleton: multiple imports return same `prisma` reference
- Non-local host warning fires when `NODE_ENV` is undefined
- Non-local host warning does NOT fire for `localhost`

Existing tests in `packages/shared/tests/db.unit.test.ts` already cover the basic validation cases. New tests extend coverage for scheme validation and host warnings.

### Property-Based Tests (fast-check + Vitest)

Property-based tests verify universal properties across generated inputs. The project already has `fast-check` as a dev dependency in `packages/shared`.

**Configuration:**
- Minimum 100 iterations per property
- Library: `fast-check` (already in devDependencies)
- Runner: Vitest
- Location: `packages/shared/tests/db.property.test.ts`

**Properties to implement:**

1. **Feature: postgres-runtime, Property 1: Empty or whitespace DATABASE_URL is always rejected**
   - Generator: `fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'))` plus `fc.constant('')`
   - Assertion: `validateDatabaseUrl()` throws with message matching `/DATABASE_URL/` and `/postgresql:\/\//`

2. **Feature: postgres-runtime, Property 2: Invalid URL scheme is always rejected**
   - Generator: `fc.string()` filtered to exclude strings starting with `postgresql://` or `postgres://`, ensuring non-empty and non-whitespace
   - Assertion: `validateDatabaseUrl()` throws with scheme-related error message

3. **Feature: postgres-runtime, Property 3: Non-local host warning in non-production environments**
   - Generator: `fc.tuple(fc.domain(), fc.constantFrom(undefined, 'development', 'test', ''))` filtered to exclude `localhost` and `127.0.0.1`
   - Assertion: Warning is logged. Inverse: `localhost`/`127.0.0.1` hosts produce no warning.

### Smoke Tests

Configuration file validation (can be run without Docker):
- `docker-compose.yml` contains correct image, ports, volume, healthcheck, credentials
- Root `package.json` contains all `db:*` scripts with correct commands
- `.env.example` files exist with correct content
- `.gitignore` excludes `.env` but not `.env.example`
- `packages/shared/package.json` contains `studio` and `db:reset` scripts

Location: `packages/shared/tests/schema.smoke.test.ts` (extend existing)

### Integration Tests

Require a running Docker PostgreSQL container:
- Volume persistence across stop/start
- `prisma migrate dev` creates migration files in correct directory
- `.env.example` copied to `.env` produces working connection
- `validateConnection()` succeeds against running database
- `validateConnection()` times out against unreachable host

These are run manually or in CI with Docker available. Not part of the default `pnpm test` run.

