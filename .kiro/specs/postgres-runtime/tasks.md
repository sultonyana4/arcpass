# Implementation Plan: postgres-runtime

## Overview

Set up local PostgreSQL runtime via Docker Compose and enhance the Prisma integration in `packages/shared` with connection validation, workspace scripts, and developer documentation. Implementation proceeds in three layers: infrastructure (Docker Compose), data access (connection validator + singleton), and developer experience (scripts + docs).

## Tasks

- [x] 1. Create Docker Compose infrastructure
  - [x] 1.1 Create `docker-compose.yml` at repository root
    - Define `postgres` service using `postgres:16-alpine` image
    - Map port `127.0.0.1:5432:5432`
    - Set environment: `POSTGRES_DB=arcpass_dev`, `POSTGRES_USER=arcpass`, `POSTGRES_PASSWORD=arcpass_local`
    - Mount named volume `arcpass_pgdata` to `/var/lib/postgresql/data`
    - Add healthcheck: `pg_isready -U arcpass -d arcpass_dev` with interval 5s, timeout 5s, retries 5, start_period 10s
    - Declare `arcpass_pgdata` in top-level `volumes` section
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 6.1, 6.2, 6.3, 6.4, 12.1, 12.4_

- [x] 2. Enhance connection validator in `packages/shared`
  - [x] 2.1 Extend `validateDatabaseUrl()` with URL scheme validation
    - Add check that `DATABASE_URL` starts with `postgresql://` or `postgres://`
    - Throw format validation error with expected scheme if invalid
    - Add non-local host warning: log `console.warn` when host is not `localhost`/`127.0.0.1` and `NODE_ENV !== 'production'`
    - _Requirements: 3.2, 3.3, 11.1, 11.4, 12.3, 12.5_

  - [x] 2.2 Implement `validateConnection()` async function
    - Call `validateDatabaseUrl()` first for format validation
    - Attempt `prisma.$connect()` with a 5-second timeout
    - Throw error with host and port on connection failure
    - Export from `packages/shared/src/db.ts`
    - _Requirements: 11.2, 11.3, 11.5_

  - [x] 2.3 Update `packages/shared/src/index.ts` exports
    - Export `validateConnection` from the package entry point
    - Ensure `prisma`, `validateDatabaseUrl`, and Prisma types remain exported
    - _Requirements: 9.3, 9.4, 11.3_

  - [ ]* 2.4 Write property test: Empty or whitespace DATABASE_URL is always rejected
    - **Property 1: Empty or whitespace DATABASE_URL is always rejected**
    - Create `packages/shared/tests/db.property.test.ts`
    - Use `fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'))` plus `fc.constant('')`
    - Assert `validateDatabaseUrl()` throws with message matching `/DATABASE_URL/` and `/postgresql:\/\//`
    - Minimum 100 iterations
    - **Validates: Requirements 3.3, 9.5, 11.1**

  - [ ]* 2.5 Write property test: Invalid URL scheme is always rejected
    - **Property 2: Invalid URL scheme is always rejected**
    - Use `fc.string()` filtered to exclude strings starting with `postgresql://` or `postgres://`, non-empty, non-whitespace
    - Assert `validateDatabaseUrl()` throws with scheme-related error message
    - Minimum 100 iterations
    - **Validates: Requirements 11.4**

  - [ ]* 2.6 Write property test: Non-local host warning in non-production environments
    - **Property 3: Non-local host warning in non-production environments**
    - Use `fc.tuple(fc.domain(), fc.constantFrom(undefined, 'development', 'test', ''))` filtered to exclude `localhost` and `127.0.0.1`
    - Assert warning is logged for non-local hosts; no warning for `localhost`/`127.0.0.1`
    - Minimum 100 iterations
    - **Validates: Requirements 12.3, 12.5**

  - [ ]* 2.7 Extend unit tests for new validation logic
    - Add tests for `mysql://` scheme rejection
    - Add tests for `validateConnection()` timeout on unreachable host (mocked)
    - Add tests for non-local host warning when `NODE_ENV` is undefined
    - Add tests for no warning on `localhost`
    - Add test that singleton returns same `prisma` reference across imports
    - _Requirements: 11.2, 11.4, 12.3, 12.5_

- [x] 3. Checkpoint - Validate connection validator
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Configure workspace scripts and environment
  - [x] 4.1 Add `db:*` scripts to root `package.json`
    - Add `db:up`: `docker compose up -d`
    - Add `db:down`: `docker compose down`
    - Add `db:generate`: `pnpm --filter @arcpass/shared generate`
    - Add `db:migrate`: `pnpm --filter @arcpass/shared migrate:dev`
    - Add `db:reset`: `pnpm --filter @arcpass/shared db:reset`
    - Add `db:studio`: `pnpm --filter @arcpass/shared studio`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 4.2 Add `studio` and `db:reset` scripts to `packages/shared/package.json`
    - Add `studio`: `prisma studio`
    - Add `db:reset`: `prisma migrate reset`
    - _Requirements: 4.3, 5.1_

  - [x] 4.3 Create/update `.env.example` files
    - Create root `.env.example` with `DATABASE_URL=postgresql://arcpass:arcpass_local@localhost:5432/arcpass_dev?schema=public` and descriptive comments
    - Update `packages/shared/.env.example` with matching content and comments about format and loading responsibility
    - _Requirements: 3.1, 3.4, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 4.4 Update root `.gitignore` for environment files
    - Add `.env` and `.env.*` exclusion patterns
    - Add `!.env.example` negation to preserve example files
    - _Requirements: 3.5_

- [x] 5. Wire app dependencies and integrate shared package
  - [x] 5.1 Add `@arcpass/shared` workspace dependency to `apps/api/package.json`
    - Add `"@arcpass/shared": "workspace:*"` to dependencies
    - _Requirements: 9.1_

  - [x] 5.2 Add `@arcpass/shared` workspace dependency to `apps/worker/package.json`
    - Add `"@arcpass/shared": "workspace:*"` to dependencies
    - _Requirements: 9.2_

- [ ] 6. Extend smoke tests for new configuration
  - [ ]* 6.1 Add smoke tests for Docker Compose and workspace scripts
    - Verify `docker-compose.yml` exists at repo root with correct image, ports, volume, healthcheck, credentials
    - Verify root `package.json` contains all `db:*` scripts with correct commands
    - Verify `packages/shared/package.json` contains `studio` and `db:reset` scripts
    - Verify root `.env.example` exists with correct `DATABASE_URL`
    - Verify root `.gitignore` excludes `.env` but not `.env.example`
    - _Requirements: 1.1–1.7, 2.1–2.2, 6.1–6.4, 7.1–7.6, 10.1–10.5_

- [x] 7. Create local development documentation
  - [x] 7.1 Create `docs/local-development.md`
    - List prerequisites: Docker, Node.js (major version), pnpm (matching `packageManager` field)
    - Numbered setup steps: copy `.env.example` → `db:up` → `db:migrate` → `db:generate` → start apps
    - Verification step with expected success output
    - Troubleshooting section with at least 3 issues: port conflicts, connection refused, migration conflicts, volume cleanup
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `packages/shared/tests/db.unit.test.ts` already covers basic empty/whitespace validation — new tests extend coverage for scheme validation and host warnings
- `fast-check` is already in `packages/shared` devDependencies

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.2", "4.3", "4.4"] },
    { "id": 1, "tasks": ["2.1", "4.1", "5.1", "5.2"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.6", "2.7"] },
    { "id": 4, "tasks": ["6.1", "7.1"] }
  ]
}
```
