# Requirements Document

## Introduction

Integrate the existing `@arcpass/worker` service into the local Docker Compose orchestration alongside the existing PostgreSQL service. The goal is to produce a containerized worker runtime that builds from the monorepo, connects to the Postgres container, and validates the full sponsorship-request lifecycle (pending → approved → relayed → completed/failed) without introducing new architecture, services, or dependencies.

## Glossary

- **Worker_Container**: The Docker container running the compiled `@arcpass/worker` application via `node --import dotenv/config dist/main.js`
- **Postgres_Container**: The existing PostgreSQL 16-alpine Docker container defined in `docker-compose.yml`
- **Compose_Orchestrator**: Docker Compose managing multi-container startup, dependency ordering, and networking
- **Prisma_Client**: The generated database client from `@prisma/client` used by the Worker_Container to query PostgreSQL
- **Poll_Cycle**: A single iteration of the worker's polling loop that queries for pending sponsorship requests and dispatches them to the processor
- **Monorepo_Build**: The multi-stage Docker build process that compiles TypeScript and resolves pnpm workspace dependencies within the container
- **Healthcheck**: A Docker-native probe that verifies a container is operational and ready to serve its function
- **Graceful_Shutdown**: The worker's signal-handling process (SIGTERM/SIGINT) that stops polling, awaits in-flight work, and disconnects Prisma before exiting

## Requirements

### Requirement 1: Worker Dockerfile

**User Story:** As a developer, I want a Dockerfile for the worker service that builds from the monorepo root, so that I can run the worker in a container without modifying the existing project structure.

#### Acceptance Criteria

1. THE Monorepo_Build SHALL use a multi-stage Docker build with at least three stages (dependency installation, compilation, and runtime) using Node.js 22-alpine as the base image
2. THE Monorepo_Build SHALL install pnpm at the version specified in the root `package.json` packageManager field using corepack enable and corepack prepare
3. THE Monorepo_Build SHALL copy only the workspace files required by `@arcpass/worker` and `@arcpass/shared` (package.json files, pnpm-workspace.yaml, pnpm-lock.yaml) and use pnpm install with a `--filter` flag scoped to `@arcpass/worker` to avoid installing unrelated workspace packages
4. THE Monorepo_Build SHALL run `pnpm install --frozen-lockfile` to install production and dev dependencies needed for compilation
5. THE Monorepo_Build SHALL compile `@arcpass/shared` (including Prisma client generation via `prisma generate`) before compiling `@arcpass/worker` via `tsc`
6. THE Monorepo_Build SHALL produce a final runtime stage containing only compiled JavaScript, production node_modules (with dev dependencies excluded), and the generated Prisma client, by using `pnpm deploy --prod` or `pnpm prune --prod` to eliminate dev dependencies
7. THE Monorepo_Build SHALL set the container WORKDIR to `/app` and set the entrypoint to `node --import dotenv/config dist/main.js`
8. THE Monorepo_Build SHALL configure the final stage with `NODE_ENV=production`
9. THE Monorepo_Build SHALL place the Dockerfile at the monorepo root (or `infra/docker/`) and reference a `.dockerignore` that excludes `node_modules`, `.git`, and `dist` directories to minimize build context size

### Requirement 2: Docker Compose Worker Service

**User Story:** As a developer, I want the worker added to the existing `docker-compose.yml`, so that `docker compose up` starts both PostgreSQL and the worker together.

#### Acceptance Criteria

1. THE Compose_Orchestrator SHALL define a `worker` service in the existing `docker-compose.yml`
2. THE Worker_Container SHALL build from the monorepo root context (`.`) using the Dockerfile at `apps/worker/Dockerfile`
3. THE Worker_Container SHALL depend on the Postgres_Container with a `service_healthy` condition
4. THE Worker_Container SHALL receive the `DATABASE_URL` environment variable set to `postgresql://arcpass:arcpass_local@postgres:5432/arcpass_dev?schema=public`
5. THE Worker_Container SHALL receive the following environment variables with these default values: `POLL_INTERVAL_MS=5000`, `BATCH_SIZE=20`, `MAX_RETRIES=5`, `RELAY_FAILURE_RATE=0.0`, `LOCK_TIMEOUT_MS=30000`, `SHUTDOWN_TIMEOUT_MS=10000`
6. THE Worker_Container SHALL use the `unless-stopped` restart policy
7. THE Compose_Orchestrator SHALL preserve the existing `postgres` service definition and `arcpass_pgdata` volume without modification

### Requirement 3: Database Connectivity

**User Story:** As a developer, I want the worker container to connect to PostgreSQL automatically on startup, so that the sponsorship processing pipeline is functional without manual intervention.

#### Acceptance Criteria

1. WHEN the Postgres_Container healthcheck passes (pg_isready succeeds after up to 5 retries at 5-second intervals), THE Worker_Container SHALL start via the Docker Compose `depends_on: service_healthy` condition
2. WHEN the Worker_Container starts, THE Prisma_Client SHALL validate that the `DATABASE_URL` environment variable is present and begins with `postgresql://` or `postgres://`, and then connect to the Postgres_Container within a 5000 ms timeout
3. IF the `DATABASE_URL` environment variable is missing or has an invalid scheme, THEN THE Worker_Container SHALL throw a configuration error describing the missing or malformed variable and exit with a non-zero status code
4. IF the Prisma_Client fails to connect to the database within the 5000 ms timeout, THEN THE Worker_Container SHALL log the connection error including the target host and port, and exit with a non-zero status code
5. WHEN the Worker_Container exits with a non-zero status, THE Compose_Orchestrator SHALL restart the Worker_Container according to the `unless-stopped` restart policy

### Requirement 4: Worker Polling Lifecycle

**User Story:** As a developer, I want the containerized worker to execute its polling loop correctly, so that sponsorship requests are processed end-to-end inside Docker.

#### Acceptance Criteria

1. WHEN the Worker_Container starts successfully, THE Worker_Container SHALL execute the first Poll_Cycle immediately and schedule subsequent Poll_Cycles using setTimeout with the configured `POLL_INTERVAL_MS` delay (valid range: 1000–60000 ms, default: 5000 ms) so that no two Poll_Cycles overlap
2. WHILE the Worker_Container is running, THE Worker_Container SHALL query the `sponsorship_requests` table for rows with status `pending`, ordered by `requestedAt` ASC, limited to at most `BATCH_SIZE` rows per Poll_Cycle (valid range: 1–100, default: 20)
3. WHEN pending sponsorship requests are returned in a Poll_Cycle, THE Worker_Container SHALL process each request sequentially within the batch, acquiring a row-level lock via SELECT FOR UPDATE SKIP LOCKED, and transition the request through the lifecycle state machine (pending → approved → relayed → completed/failed) within a single database transaction
4. IF a request has been retried a number of times equal to or exceeding `MAX_RETRIES` (default: 5), THEN THE Worker_Container SHALL transition that request to `failed` status without attempting relay
5. IF a Poll_Cycle encounters a processing error for an individual request, THEN THE Worker_Container SHALL log the error, leave the request in its current status, and continue processing the remaining requests in the batch before scheduling the next Poll_Cycle
6. IF a Poll_Cycle encounters an unrecoverable error outside individual request processing, THEN THE Worker_Container SHALL log the error and schedule the next Poll_Cycle after the configured `POLL_INTERVAL_MS` delay

### Requirement 5: Graceful Shutdown

**User Story:** As a developer, I want the worker container to shut down cleanly when Docker sends stop signals, so that in-flight work completes and database connections are released.

#### Acceptance Criteria

1. WHEN the Compose_Orchestrator sends SIGTERM or SIGINT to the Worker_Container, THE Worker_Container SHALL initiate Graceful_Shutdown and ignore any subsequent SIGTERM or SIGINT signals received while Graceful_Shutdown is already in progress
2. WHILE Graceful_Shutdown is in progress, THE Worker_Container SHALL stop scheduling new Poll_Cycles and SHALL NOT dispatch new requests from the current batch
3. WHILE Graceful_Shutdown is in progress, THE Worker_Container SHALL await completion of the currently executing request processing (if any) for up to `SHUTDOWN_TIMEOUT_MS` milliseconds (default: 10000)
4. WHEN Graceful_Shutdown completes within `SHUTDOWN_TIMEOUT_MS`, THE Prisma_Client SHALL disconnect from the database and THE Worker_Container SHALL exit with status code 0
5. IF Graceful_Shutdown exceeds `SHUTDOWN_TIMEOUT_MS` or an error occurs during the shutdown sequence, THEN THE Worker_Container SHALL exit with status code 1

### Requirement 6: Startup Validation Logging

**User Story:** As a developer, I want clear log output during container startup, so that I can verify the worker initialized correctly without inspecting internal state.

#### Acceptance Criteria

1. WHEN the Worker_Container starts, THE Worker_Container SHALL log each loaded configuration value (pollIntervalMs, batchSize, maxRetries, relayFailureRate, lockTimeoutMs, shutdownTimeoutMs) to stdout, with the DATABASE_URL masked to show only the host and port while replacing the username and password with asterisks
2. WHEN the Prisma_Client connects successfully, THE Worker_Container SHALL log a database connection confirmation message to stdout that includes the database host and port
3. WHEN the first Poll_Cycle begins, THE Worker_Container SHALL log a message to stdout indicating that polling has started, including the configured pollIntervalMs and batchSize values
4. IF the Worker_Container fails to start due to a missing or invalid environment variable, THEN THE Worker_Container SHALL log an error message to stderr identifying the variable name and the reason for failure, and exit with a non-zero exit code
5. IF the Worker_Container fails to start due to a database connection failure, THEN THE Worker_Container SHALL log an error message to stderr identifying the database host, port, and the connection error reason, and exit with a non-zero exit code

### Requirement 7: ESM and Prisma Compatibility

**User Story:** As a developer, I want the containerized worker to resolve ESM imports and the generated Prisma client correctly, so that the runtime behaves identically to local development.

#### Acceptance Criteria

1. WHEN the Worker_Container starts the worker process, THE Worker_Container SHALL execute `dist/main.js` under Node.js ESM resolution (NodeNext module system) without module-format errors, as confirmed by the `"type": "module"` field in the container's `package.json`
2. WHEN the worker process imports `@arcpass/shared`, THE Worker_Container SHALL resolve the import to the package's `dist/index.js` within the container's `node_modules/@arcpass/shared/` directory without throwing an ERR_MODULE_NOT_FOUND error
3. WHEN the worker process instantiates PrismaClient, THE Prisma_Client SHALL locate the generated query engine binary and schema artifacts within the container's `node_modules/.prisma/client/` directory, matching the container's target platform (e.g., linux-musl for Alpine, linux for Debian)
4. WHEN the Worker_Container starts with the `--import dotenv/config` loader flag, THE Worker_Container SHALL load environment variables from the container's environment into `process.env` before application code executes, without throwing an ERR_MODULE_NOT_FOUND error for the dotenv package
5. IF the Prisma query engine binary is missing or incompatible with the container's platform, THEN THE Worker_Container SHALL fail to start and produce an error message indicating the missing or incompatible engine binary

### Requirement 8: Database Migration on Startup

**User Story:** As a developer, I want database migrations to run before the worker begins processing, so that the schema is always up-to-date when the container starts.

#### Acceptance Criteria

1. WHEN the Worker_Container starts, THE Worker_Container SHALL execute `prisma migrate deploy` against the Postgres_Container before initializing the polling loop
2. IF a migration fails, THEN THE Worker_Container SHALL log the migration error and exit with a non-zero status code without starting the polling loop
3. THE Worker_Container SHALL use `prisma migrate deploy` for migration execution (no interactive prompts, no schema drift checks)
4. THE Monorepo_Build SHALL include the Prisma CLI, the Prisma schema file, and the migrations directory in the final runtime stage of the Worker_Container
