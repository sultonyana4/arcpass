# Design Document: Worker Docker Integration

## Overview

This design integrates the existing `@arcpass/worker` service into the local Docker Compose orchestration. The solution uses a multi-stage Dockerfile that builds from the monorepo root, leveraging `pnpm deploy --prod` to produce a minimal runtime image containing only the worker's production dependencies. The worker container starts alongside the existing PostgreSQL container, runs Prisma migrations, validates connectivity, and begins its polling loop.

Key design decisions:
- **Node.js 22-alpine** as base image for small footprint and LTS support
- **`pnpm deploy --prod`** to isolate the worker's production dependencies (including workspace deps) into a self-contained directory
- **Three-stage build** (deps → build → runtime) to minimize final image size
- **Entrypoint script** that runs `prisma migrate deploy` before launching the worker process
- **OpenSSL installation** in the runtime stage to satisfy Prisma's query engine requirements on Alpine

## Architecture

### Container Orchestration Topology

```mermaid
graph TB
    subgraph "Docker Compose Network (default)"
        PG[postgres<br/>postgres:16-alpine<br/>Port 5432]
        W[worker<br/>node:22-alpine<br/>Polls DB]
    end

    W -->|DATABASE_URL<br/>postgresql://...@postgres:5432/arcpass_dev| PG
    W -.->|depends_on: service_healthy| PG

    subgraph "Volumes"
        V[arcpass_pgdata]
    end
    PG --> V
```

### Multi-Stage Build Pipeline

```mermaid
graph LR
    subgraph "Stage 1: deps"
        A1[node:22-alpine] --> A2[corepack enable/prepare pnpm]
        A2 --> A3[Copy workspace manifests]
        A3 --> A4[pnpm install --frozen-lockfile]
    end

    subgraph "Stage 2: build"
        B1[Copy source from deps] --> B2[Build @arcpass/shared<br/>prisma generate + tsc]
        B2 --> B3[Build @arcpass/worker<br/>tsc]
        B3 --> B4[pnpm deploy --prod<br/>to /app/deploy]
    end

    subgraph "Stage 3: runtime"
        C1[node:22-alpine] --> C2[Install openssl]
        C2 --> C3[Copy /app/deploy]
        C3 --> C4[Copy prisma schema + migrations]
        C4 --> C5[Copy entrypoint.sh]
        C5 --> C6[ENTRYPOINT entrypoint.sh]
    end

    A4 --> B1
    B4 --> C3
```

### Startup Sequence

```mermaid
sequenceDiagram
    participant DC as Docker Compose
    participant PG as postgres
    participant W as worker

    DC->>PG: Start container
    PG->>PG: Initialize database
    PG->>DC: Healthcheck passes (pg_isready)
    DC->>W: Start container (depends_on: service_healthy)
    W->>W: entrypoint.sh begins
    W->>PG: prisma migrate deploy
    PG-->>W: Migrations applied
    W->>W: node --import dotenv/config dist/main.js
    W->>W: loadConfig() — validate env vars, log config
    W->>PG: Prisma $connect() (5000ms timeout)
    PG-->>W: Connection established
    W->>W: Start polling loop
```

## Components and Interfaces

### 1. Dockerfile (`apps/worker/Dockerfile`)

**Stage 1: `deps`** — Dependency installation
- Base: `node:22-alpine`
- Enables corepack, prepares pnpm@10.33.0
- Copies only workspace manifests (`package.json` files, `pnpm-workspace.yaml`, `pnpm-lock.yaml`)
- Runs `pnpm install --frozen-lockfile` scoped to the worker and its dependencies

**Stage 2: `build`** — Compilation and deployment preparation
- Copies full source from the deps stage
- Builds `@arcpass/shared` (runs `prisma generate` then `tsc`)
- Builds `@arcpass/worker` (runs `tsc`)
- Runs `pnpm deploy --filter=@arcpass/worker --prod /app/deploy` to create an isolated production deployment

**Stage 3: `runtime`** — Minimal production image
- Base: `node:22-alpine`
- Installs `openssl` (required by Prisma query engine on Alpine/musl)
- Copies the deployed app from stage 2
- Copies Prisma schema and migrations directory
- Copies the entrypoint shell script
- Sets `NODE_ENV=production`, `WORKDIR=/app`
- Entrypoint: `./entrypoint.sh`

### 2. Entrypoint Script (`apps/worker/entrypoint.sh`)

A shell script that:
1. Runs `npx prisma migrate deploy --schema=./prisma/schema.prisma`
2. On success: executes `node --import dotenv/config dist/main.js`
3. On failure: logs the error and exits with code 1

This ensures migrations always run before the worker process starts, without modifying the worker's TypeScript source code.

### 3. Docker Compose Service Definition

The `worker` service is added to the existing `docker-compose.yml`:
- **build context**: `.` (monorepo root)
- **dockerfile**: `apps/worker/Dockerfile`
- **depends_on**: `postgres` with `condition: service_healthy`
- **environment**: All required env vars with defaults
- **restart**: `unless-stopped`

### 4. `.dockerignore` File

Placed at the monorepo root to minimize build context:
- Excludes `node_modules/`, `.git/`, `dist/`, `*.md`, `.env` files, `.turbo/`

### 5. Existing Worker Modules (Unchanged)

| Module | Role in Container |
|--------|-------------------|
| `main.ts` | Process entry point, signal handlers (SIGTERM/SIGINT) |
| `worker.ts` | Orchestrates config loading, Prisma connection, poller lifecycle |
| `config.ts` | Validates environment variables from container env |
| `poller.ts` | setTimeout-based polling loop, sequential batch dispatch |
| `processor.ts` | Full lifecycle processing with SELECT FOR UPDATE SKIP LOCKED |
| `lifecycle.ts` | State machine transitions |
| `relay-simulator.ts` | Mock blockchain relay |

## Data Models

No new data models are introduced. The existing Prisma schema remains unchanged:

- **Wallet** — Registered wallet addresses
- **SponsorshipRequest** — Sponsorship lifecycle tracking (pending → approved → relayed → completed/failed)
- **RelayTransaction** — Individual relay attempts per sponsorship request
- **RateLimit** — Rate limiting records

### Environment Variable Configuration

| Variable | Type | Default | Validation |
|----------|------|---------|------------|
| `DATABASE_URL` | string | (required) | Must start with `postgresql://` or `postgres://` |
| `POLL_INTERVAL_MS` | number | 5000 | Range: 1000–60000 |
| `BATCH_SIZE` | number | 20 | Range: 1–100 |
| `MAX_RETRIES` | number | 5 | Positive integer |
| `RELAY_FAILURE_RATE` | number | 0.0 | Range: 0.0–1.0 |
| `LOCK_TIMEOUT_MS` | number | 30000 | Positive integer |
| `SHUTDOWN_TIMEOUT_MS` | number | 10000 | Positive integer |

### Docker Compose Environment Mapping

```yaml
environment:
  DATABASE_URL: postgresql://arcpass:arcpass_local@postgres:5432/arcpass_dev?schema=public
  POLL_INTERVAL_MS: 5000
  BATCH_SIZE: 20
  MAX_RETRIES: 5
  RELAY_FAILURE_RATE: "0.0"
  LOCK_TIMEOUT_MS: 30000
  SHUTDOWN_TIMEOUT_MS: 10000
```

## Error Handling

### Build-Time Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `pnpm install` fails | Lock file mismatch or network issue | Ensure `pnpm-lock.yaml` is committed and up-to-date; rebuild with `--no-cache` |
| `prisma generate` fails | Missing schema or invalid schema syntax | Fix `schema.prisma` and rebuild |
| `tsc` compilation fails | TypeScript errors in worker or shared | Fix source code and rebuild |
| `pnpm deploy` fails | Workspace resolution error | Ensure `pnpm-workspace.yaml` includes all required packages |

### Runtime Startup Errors

| Error | Cause | Container Behavior |
|-------|-------|-------------------|
| `prisma migrate deploy` fails | Schema conflict, unreachable DB, or invalid migration | Log error to stderr, exit code 1, Docker restarts via `unless-stopped` |
| Missing `DATABASE_URL` | Environment variable not set | `loadConfig()` throws, logged to stderr, exit code 1 |
| Invalid `DATABASE_URL` scheme | URL doesn't start with `postgresql://` or `postgres://` | `validateDatabaseUrl()` throws, logged to stderr, exit code 1 |
| Database connection timeout | Postgres not ready or network issue | `validateConnection()` throws after 5000ms, logged to stderr, exit code 1 |
| Prisma engine binary missing | Incorrect platform or incomplete build | PrismaClientInitializationError, logged to stderr, exit code 1 |
| ESM module resolution failure | Missing dependency in production node_modules | ERR_MODULE_NOT_FOUND, logged to stderr, exit code 1 |

### Runtime Processing Errors

| Error | Cause | Container Behavior |
|-------|-------|-------------------|
| Individual request processing fails | Transaction timeout, constraint violation | Log error, leave request in current status, continue batch |
| Poll cycle database error | Connection lost, query timeout | Log error, schedule next poll cycle after `POLL_INTERVAL_MS` |
| Unhandled rejection | Unexpected runtime error | Process exits, Docker restarts via `unless-stopped` |

### Shutdown Errors

| Scenario | Behavior |
|----------|----------|
| Graceful shutdown completes within timeout | Prisma disconnects, exit code 0 |
| Shutdown exceeds `SHUTDOWN_TIMEOUT_MS` | Force exit with code 1 |
| Error during Prisma disconnect | Log error, exit code 1 |
| Multiple SIGTERM/SIGINT signals | Ignored after first signal (idempotent guard) |

### Restart Policy Behavior

The `unless-stopped` restart policy means:
- Container restarts automatically on non-zero exit (crash, migration failure, connection timeout)
- Container does NOT restart if explicitly stopped via `docker compose stop` or `docker compose down`
- Docker applies exponential backoff between restart attempts (100ms, 200ms, 400ms, ... up to 1 minute)

## Testing Strategy

### Why Property-Based Testing Does Not Apply

This feature is primarily infrastructure configuration (Dockerfile, Docker Compose YAML, shell entrypoint script) and container orchestration. The acceptance criteria fall into two categories:

1. **SMOKE tests** — Structural checks on configuration files (Dockerfile stages, compose service definition, .dockerignore contents)
2. **INTEGRATION tests** — Verifying container behavior against external systems (Docker engine, PostgreSQL, filesystem)

No new pure functions with meaningful input variation are introduced. The existing worker logic (config validation, polling, processing, shutdown) is already implemented and tested separately. This feature wraps that existing code in Docker infrastructure without modifying it.

### Test Approach

#### Smoke Tests (Configuration Validation)

Verify the structural correctness of configuration artifacts without running containers:

- **Dockerfile structure**: Verify 3+ stages, correct base images, presence of required commands (`corepack enable`, `pnpm install --frozen-lockfile`, `pnpm deploy --prod`)
- **Docker Compose schema**: Validate `worker` service definition, `depends_on` condition, environment variables, restart policy, preserved `postgres` service
- **`.dockerignore` contents**: Verify exclusion of `node_modules`, `.git`, `dist`
- **Entrypoint script**: Verify `prisma migrate deploy` runs before `node` command

These can be implemented as simple unit tests that parse the files and assert on their contents.

#### Integration Tests (Container Behavior)

Verify end-to-end container behavior by building and running the Docker setup:

1. **Build test**: `docker compose build worker` succeeds without errors
2. **Startup sequence**: `docker compose up` starts postgres first, then worker after healthcheck passes
3. **Migration execution**: Worker runs `prisma migrate deploy` before polling (verified via logs)
4. **Database connectivity**: Worker connects to postgres and logs confirmation
5. **Polling lifecycle**: Seed pending requests, verify they transition through the state machine
6. **Graceful shutdown**: `docker compose stop worker` triggers clean shutdown (exit code 0)
7. **Restart on failure**: Remove DATABASE_URL, verify container exits and restarts
8. **ESM resolution**: No module resolution errors in container logs
9. **Prisma engine**: No engine binary errors in container logs

#### Example-Based Tests (Specific Scenarios)

- Missing DATABASE_URL → error message identifies the variable
- Invalid DATABASE_URL scheme → error message describes expected format
- Unreachable database → timeout error with host/port in message
- Failed migration → container exits without starting poller
- Config logging → DATABASE_URL is masked (credentials replaced with asterisks)

### Test Tooling

- **Smoke tests**: Vitest with file-reading assertions (parse Dockerfile, YAML, shell script)
- **Integration tests**: Shell scripts or Vitest with `child_process` calling `docker compose` commands
- **Log verification**: `docker compose logs worker` parsed for expected messages

### Test Execution

```bash
# Smoke tests (no Docker required)
pnpm --filter @arcpass/worker test:unit

# Integration tests (requires Docker)
docker compose build worker
docker compose up -d
# ... run integration test suite
docker compose down
```

