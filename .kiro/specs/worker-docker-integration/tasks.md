# Implementation Plan: Worker Docker Integration

## Overview

Containerize the existing `@arcpass/worker` service using a multi-stage Dockerfile, integrate it into the existing Docker Compose orchestration alongside PostgreSQL, and ensure migrations run on startup via an entrypoint script. No modifications to existing worker TypeScript source code are needed — this is purely infrastructure configuration.

## Tasks

- [x] 1. Create Docker build infrastructure
  - [x] 1.1 Create `.dockerignore` at the monorepo root
    - Exclude `node_modules/`, `.git/`, `dist/`, `*.md`, `.env`, `.env.*`, `.turbo/`, and IDE config directories
    - Ensure build context is minimal for fast Docker builds
    - _Requirements: 1.9_

  - [x] 1.2 Create the multi-stage Dockerfile at `apps/worker/Dockerfile`
    - **Stage 1 (`deps`)**: Use `node:22-alpine` base, enable corepack, prepare `pnpm@10.33.0`, copy workspace manifests (`package.json` files, `pnpm-workspace.yaml`, `pnpm-lock.yaml`), run `pnpm install --frozen-lockfile`
    - **Stage 2 (`build`)**: Copy full source from deps stage, build `@arcpass/shared` (run `prisma generate` then `tsc`), build `@arcpass/worker` (run `tsc`), run `pnpm deploy --filter=@arcpass/worker --prod /app/deploy` to create isolated production output
    - **Stage 3 (`runtime`)**: Use `node:22-alpine` base, install `openssl` for Prisma engine compatibility, copy deployed app from stage 2, copy Prisma schema and migrations directory, copy entrypoint script, set `NODE_ENV=production`, `WORKDIR=/app`, entrypoint to `./entrypoint.sh`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 7.1, 7.2, 7.3, 7.4, 8.4_

  - [x] 1.3 Create the entrypoint script at `apps/worker/entrypoint.sh`
    - Run `npx prisma migrate deploy --schema=./prisma/schema.prisma`
    - On success: exec `node --import dotenv/config dist/main.js`
    - On failure: log the migration error to stderr and exit with code 1
    - Ensure the script has a proper shebang (`#!/bin/sh`) and is executable
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 2. Configure Docker Compose worker service
  - [x] 2.1 Add the `worker` service to the existing `docker-compose.yml`
    - Set build context to `.` (monorepo root) with dockerfile `apps/worker/Dockerfile`
    - Add `depends_on: postgres` with `condition: service_healthy`
    - Set environment variables: `DATABASE_URL=postgresql://arcpass:arcpass_local@postgres:5432/arcpass_dev?schema=public`, `POLL_INTERVAL_MS=5000`, `BATCH_SIZE=20`, `MAX_RETRIES=5`, `RELAY_FAILURE_RATE=0.0`, `LOCK_TIMEOUT_MS=30000`, `SHUTDOWN_TIMEOUT_MS=10000`
    - Set restart policy to `unless-stopped`
    - Preserve the existing `postgres` service and `arcpass_pgdata` volume definitions unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.5_

- [x] 3. Checkpoint - Verify Docker build
  - Ensure `docker compose build worker` completes successfully without errors, ask the user if questions arise.

- [x] 4. Write smoke tests for configuration artifacts
  - [x] 4.1 Write smoke tests for Dockerfile structure
    - Parse `apps/worker/Dockerfile` and assert: at least 3 `FROM` stages, `node:22-alpine` base images, presence of `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm deploy --prod`, `NODE_ENV=production`, `openssl` installation
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.8, 7.3_

  - [x] 4.2 Write smoke tests for Docker Compose worker service definition
    - Parse `docker-compose.yml` and assert: `worker` service exists, build context is `.`, dockerfile is `apps/worker/Dockerfile`, `depends_on` has `postgres` with `condition: service_healthy`, all environment variables present with correct defaults, restart policy is `unless-stopped`, `postgres` service and `arcpass_pgdata` volume are unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 4.3 Write smoke tests for `.dockerignore` and entrypoint script
    - Assert `.dockerignore` excludes `node_modules`, `.git`, `dist`
    - Assert `apps/worker/entrypoint.sh` contains `prisma migrate deploy` before the `node` command, has proper shebang line
    - _Requirements: 1.9, 8.1, 8.3_

- [x] 5. Checkpoint - Ensure all smoke tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write integration tests for container behavior
  - [ ]* 6.1 Write integration test for container startup and database connectivity
    - Build and start the worker container via Docker Compose
    - Verify worker logs show configuration values (with masked DATABASE_URL)
    - Verify worker logs show database connection confirmation with host and port
    - Verify worker logs show polling started message with pollIntervalMs and batchSize
    - _Requirements: 3.2, 6.1, 6.2, 6.3_

  - [ ]* 6.2 Write integration test for migration execution on startup
    - Verify container logs show `prisma migrate deploy` output before polling starts
    - _Requirements: 8.1, 8.2_

  - [ ]* 6.3 Write integration test for ESM and Prisma compatibility
    - Verify no `ERR_MODULE_NOT_FOUND` errors in container logs
    - Verify no Prisma engine binary errors in container logs
    - Verify `@arcpass/shared` resolves correctly (no import errors)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 6.4 Write integration test for error scenarios
    - Test missing DATABASE_URL: verify error message identifies the variable and container exits non-zero
    - Test invalid DATABASE_URL scheme: verify error message describes expected format
    - Test unreachable database: verify timeout error with host/port in message
    - _Requirements: 3.3, 3.4, 6.4, 6.5_

  - [ ]* 6.5 Write integration test for graceful shutdown
    - Send `docker compose stop worker` and verify exit code 0
    - Verify logs show clean shutdown (Prisma disconnect)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirement acceptance criteria for traceability
- No modifications to existing worker TypeScript source code are needed
- The Dockerfile, entrypoint script, and Docker Compose changes are the only new artifacts
- Integration tests require Docker to be running and may take longer to execute
- Smoke tests can run without Docker by parsing configuration files directly

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] }
  ]
}
```
