---
title: "Docker Architecture"
description: "Docker Compose services, networking, environment configuration, and multi-stage build patterns for ArcPass."
---

# Docker Architecture

ArcPass uses Docker Compose to orchestrate four services: a PostgreSQL database, a Fastify API server, a blockchain relay worker, and a Next.js web frontend. This document covers service definitions, networking, environment configuration, and the multi-stage Dockerfile build pattern.

## Services Overview

```mermaid
graph TD
    web[web :3000] -->|HTTP| api[api :4000]
    api -->|TCP :5432| postgres[(postgres :5432)]
    worker -->|TCP :5432| postgres
    web -.->|depends_on| api
    api -.->|depends_on| postgres
    worker -.->|depends_on| postgres
```

## Service Definitions

### postgres

The PostgreSQL 16 database running on Alpine Linux.

| Property | Value |
|----------|-------|
| Image | `postgres:16-alpine` |
| Exposed ports | `127.0.0.1:5433:5432` (host 5433 → container 5432) |
| Volume mounts | `arcpass_pgdata:/var/lib/postgresql/data` (named volume for data persistence) |
| Dependency order | None (root service) |
| Restart policy | None (default) |

**Health check:**

```yaml
test: ["CMD-SHELL", "pg_isready -U arcpass -d arcpass_dev"]
interval: 5s
timeout: 5s
retries: 5
start_period: 10s
```

The health check uses `pg_isready` to verify the database is accepting connections before dependent services start.

---

### api

The Fastify API server handling wallet registration, sponsorship requests, and health endpoints.

| Property | Value |
|----------|-------|
| Build context | `.` (repo root) |
| Dockerfile | `apps/api/Dockerfile` |
| Exposed ports | `127.0.0.1:4000:4000` (host 4000 → container 4000) |
| Volume mounts | None |
| Dependency order | `postgres` (condition: `service_healthy`) |
| Restart policy | `unless-stopped` |

**Health check:**

```yaml
test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/health || exit 1"]
interval: 5s
timeout: 5s
retries: 5
start_period: 15s
```

The API health check hits the `/health` endpoint. The 15-second start period allows time for database migrations to complete on first boot.

---

### worker

The blockchain relay worker that polls for approved sponsorship requests and executes on-chain relay transactions.

| Property | Value |
|----------|-------|
| Build context | `.` (repo root) |
| Dockerfile | `apps/worker/Dockerfile` |
| Exposed ports | None (internal service only) |
| Volume mounts | None |
| Dependency order | `postgres` (condition: `service_healthy`) |
| Restart policy | `unless-stopped` |

**Health check:** None configured. The worker is a background process without an HTTP interface. Operational health is inferred from database activity (processing sponsorship requests).

---

### web

The Next.js frontend serving the public onboarding UI and infrastructure dashboard.

| Property | Value |
|----------|-------|
| Build context | `.` (repo root) |
| Dockerfile | `apps/web/Dockerfile` |
| Exposed ports | `3000:3000` (host 3000 → container 3000) |
| Volume mounts | None |
| Dependency order | `api` (condition: `service_healthy`) |
| Restart policy | `unless-stopped` |
| Build args | `NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS`, `NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS` |

**Health check:**

```yaml
test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:3000 || exit 1"]
interval: 5s
timeout: 5s
retries: 5
start_period: 20s
```

The web health check verifies the Next.js server is responding. The 20-second start period accounts for the API dependency needing to be healthy first.

## Startup Order

Services start in dependency order, waiting for health checks to pass:

1. **postgres** — starts first, no dependencies
2. **api** — starts after postgres is healthy (runs migrations on boot)
3. **worker** — starts after postgres is healthy (runs in parallel with api)
4. **web** — starts after api is healthy

## Internal Docker Networking

All services share the default Docker Compose bridge network. Containers communicate using service names as DNS hostnames, resolved by Docker's embedded DNS server.

### Service-to-Service Connections

| Source | Destination | Connection String | Purpose |
|--------|-------------|-------------------|---------|
| api | postgres | `postgres:5432` | Database queries and migrations |
| worker | postgres | `postgres:5432` | Polling for approved requests, status updates |
| web | api | `api:4000` | API proxy (via `API_URL_INTERNAL`) |

### Network Resolution Rules

- **Internal traffic** uses service names: `postgres`, `api`, `worker`, `web`
- **External access** uses host-bound ports: `localhost:5433` (postgres), `localhost:4000` (api), `localhost:3000` (web)
- The worker has no exposed port — it is only reachable within the Docker network
- The web service communicates with the API using the internal URL `http://api:4000`, never the host-bound port

<Note>
All host-bound ports for postgres and api are restricted to `127.0.0.1` to prevent external network access during development. The web service binds to `0.0.0.0:3000` for broader access.
</Note>

## Environment Variables

### postgres

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `POSTGRES_DB` | Database name to create on first run | `arcpass_dev` | Required |
| `POSTGRES_USER` | Database superuser name | `arcpass` | Required |
| `POSTGRES_PASSWORD` | Database superuser password | `arcpass_local` | Required |

### api

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://arcpass:arcpass_local@postgres:5432/arcpass_dev?schema=public` | Required |
| `PORT` | HTTP server listen port | `4000` | Required |
| `NODE_ENV` | Node.js environment mode | `production` | Required |
| `LOG_LEVEL` | Logging verbosity (debug, info, warn, error) | `info` | Optional |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `http://localhost:3000,http://web:3000,http://127.0.0.1:3000` | Optional |

### worker

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://arcpass:arcpass_local@postgres:5432/arcpass_dev?schema=public` | Required |
| `CHAIN_RPC_URL` | RPC endpoint for the Arc network | `https://rpc.testnet.arc.network` | Required |
| `SPONSOR_PRIVATE_KEY` | Relay operator private key (64 hex chars) | None | Required |
| `CHAIN_ID` | Expected chain ID for RPC verification | `5042002` | Required |
| `CONTRACT_ADDRESS_SPONSOR_VAULT` | Deployed SponsorVault contract address | `0x0000000000000000000000000000000000000000` | Required |
| `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY` | Deployed SponsorshipRegistry contract address | `0x0000000000000000000000000000000000000000` | Required |
| `POLL_INTERVAL_MS` | Polling interval for approved requests (ms) | `5000` | Optional |
| `BATCH_SIZE` | Maximum requests to process per poll cycle | `20` | Optional |
| `MAX_RETRIES` | Maximum relay retry attempts before marking failed | `5` | Optional |
| `RELAY_FAILURE_RATE` | Simulated failure rate for testing (0.0–1.0) | `0.0` | Optional |
| `LOCK_TIMEOUT_MS` | Row-level lock acquisition timeout (ms) | `30000` | Optional |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown drain timeout (ms) | `10000` | Optional |
| `SPONSORSHIP_AMOUNT_WEI` | Amount of wei to sponsor per transaction | `1000000000000000` | Optional |
| `CHAIN_ID_VERIFY_TIMEOUT_MS` | Timeout for chain ID verification at startup (ms) | `10000` | Optional |

### web

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `API_URL_INTERNAL` | Internal URL for API proxy (service-to-service) | `http://api:4000` | Required |
| `NODE_ENV` | Node.js environment mode | `production` | Required |
| `NEXT_PUBLIC_EXPLORER_URL` | Block explorer base URL for transaction links | `https://testnet.arcscan.app/tx/` | Optional |
| `NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS` | SponsorVault contract address (inlined at build time) | None | Optional |
| `NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS` | SponsorshipRegistry contract address (inlined at build time) | None | Optional |
| `NEXT_PUBLIC_GITHUB_URL` | GitHub repository URL for UI links | None | Optional |

<Warning>
`NEXT_PUBLIC_*` variables are inlined at build time by Next.js. Changing them requires rebuilding the web container image — runtime environment changes alone will not take effect.
</Warning>

## Multi-Stage Dockerfile Build Pattern

All application services (api, worker, web) use a multi-stage Docker build to minimize final image size and separate build-time dependencies from runtime.

### Stage Overview

```mermaid
graph LR
    A[deps] --> B[build]
    A --> C[prod-deps]
    B --> D[runtime]
    C --> D
```

### Stage 1: deps

**Purpose:** Install all workspace dependencies (dev + prod) needed for compilation.

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/*/package.json ./apps/*/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
```

Key decisions:
- Uses `node:22-alpine` for a minimal base
- Enables corepack with pinned pnpm version (`10.33.0`)
- Copies only workspace manifests first for Docker layer caching — source changes don't invalidate the dependency layer
- Installs all dependencies (dev included) because build tooling (TypeScript, Prisma CLI) is needed in the next stage

### Stage 2: build

**Purpose:** Compile TypeScript, generate Prisma client, and produce build artifacts.

```dockerfile
FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm --filter @arcpass/shared exec prisma generate
RUN pnpm --filter @arcpass/shared exec tsc
RUN pnpm --filter @arcpass/<service> exec tsc  # or `run build` for web
```

Key decisions:
- Extends the `deps` stage (all dependencies available)
- Copies full source code
- Builds `@arcpass/shared` first (Prisma client generation + TypeScript compilation)
- Then builds the target service
- For the web service, runs `next build` with standalone output mode

### Stage 3: prod-deps

**Purpose:** Install only production dependencies for the final image.

```dockerfile
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/*/package.json ./apps/*/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --prod --node-linker=hoisted
```

Key decisions:
- Fresh `node:22-alpine` base (no dev dependencies carried over)
- Uses `--prod` flag to exclude devDependencies
- Uses `--node-linker=hoisted` to produce a flat `node_modules` without pnpm symlinks, ensuring compatibility in the runtime stage
- This stage runs in parallel with `build` during Docker BuildKit execution

<Info>
The web service uses a 3-stage pattern (deps → build → runtime) instead of 4 stages because Next.js standalone output bundles its own dependencies, eliminating the need for a separate prod-deps stage.
</Info>

### Stage 4: runtime

**Purpose:** Minimal production image with only the artifacts needed to run the service.

```dockerfile
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/<service>/dist ./dist
COPY --from=build /app/packages/shared/dist ./node_modules/@arcpass/shared/dist
COPY --from=build /app/packages/shared/prisma ./prisma
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client ./node_modules/.prisma/client
ENV NODE_ENV=production
```

Key decisions:
- Fresh Alpine base with only `openssl` added (required by Prisma query engine on musl)
- Copies production `node_modules` from `prod-deps`
- Copies compiled output from `build`
- Copies the generated Prisma client binary
- Copies Prisma schema and migrations for runtime migration execution
- No TypeScript compiler, no dev tooling, no source maps in the final image

### Service-Specific Variations

| Service | Stages | Entry Point | Notes |
|---------|--------|-------------|-------|
| api | deps → build → prod-deps → runtime | `node src/server.js` (runs migrations first via shell) | API source is plain JS, no tsc step needed for its own code |
| worker | deps → build → prod-deps → runtime | `./entrypoint.sh` | Custom entrypoint script handles startup logic |
| web | deps → build → runtime | `node apps/web/server.js` | Uses Next.js standalone output; no prod-deps stage needed |

## Volumes

| Volume Name | Mount Path | Purpose |
|-------------|-----------|---------|
| `arcpass_pgdata` | `/var/lib/postgresql/data` | Persists PostgreSQL data across container restarts |

<Tip>
To reset the database completely, remove the named volume: `docker compose down -v`. This destroys all data and forces a fresh database on next startup.
</Tip>

## Related Documentation

- [System Overview](../architecture/system-overview.md) — full request flow and Docker networking diagram
- [GCP Deployment](./gcp-deployment.md) — production deployment procedures
- [Runbooks](../operations/runbooks.md) — Docker troubleshooting and rebuild procedures
- [Installation Guide](../getting-started/installation.md) — local development setup with Docker
