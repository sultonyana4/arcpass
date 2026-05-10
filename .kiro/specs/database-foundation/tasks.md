# Implementation Plan: Database Foundation

## Overview

Initialize Prisma + PostgreSQL foundation in the `packages/shared` workspace package. This plan sets up the package structure, Prisma schema with all four core entities, singleton client export, migration workflow scripts, environment configuration, and monorepo integration. All code is TypeScript ESM targeting the existing pnpm + Turborepo pipeline.

## Tasks

- [x] 1. Set up package structure and configuration
  - [x] 1.1 Create `packages/shared/package.json` with name `@arcpass/shared`, ESM type, exports field, dependencies (`@prisma/client`), devDependencies (`prisma`, `typescript`, `fast-check`, `vitest`), and scripts (`generate`, `build`, `migrate:dev`, `migrate:deploy`, `db:push`)
    - `"build"` script must chain `prisma generate && tsc`
    - `"migrate:dev"` runs `prisma migrate dev`
    - `"migrate:deploy"` runs `prisma migrate deploy`
    - `"generate"` runs `prisma generate`
    - Set `"main": "./dist/index.js"` and `"types": "./dist/index.d.ts"`
    - _Requirements: 1.3, 1.6, 3.1, 6.2, 6.4_

  - [x] 1.2 Create `packages/shared/tsconfig.json` with target ES2022, module ESNext, moduleResolution bundler, declaration true, outDir `./dist`, rootDir `./src`, strict mode enabled
    - Include `src/**/*`, exclude `node_modules`, `dist`, `prisma`
    - _Requirements: 6.2, 6.4_

  - [x] 1.3 Create `packages/shared/.env.example` with placeholder `DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>?schema=public`
    - _Requirements: 3.6, 5.3_

  - [x] 1.4 Create `packages/shared/.gitignore` excluding `.env`, `dist/`, and `node_modules/` (but not `.env.example`)
    - _Requirements: 5.2, 5.5_

- [x] 2. Define Prisma schema with all entities and enums
  - [x] 2.1 Create `packages/shared/prisma/schema.prisma` with generator client block (`prisma-client-js`) and datasource db block (provider `postgresql`, url `env("DATABASE_URL")`)
    - _Requirements: 1.1, 1.2, 5.1_

  - [x] 2.2 Add enums to schema: `SponsorshipRequestStatus` (pending, approved, rejected, relayed, completed, failed), `RelayTransactionStatus` (queued, submitted, confirmed, failed), `RateLimitIdentifierType` (ip, wallet, user_agent)
    - _Requirements: 2.7_

  - [x] 2.3 Add `Wallet` model with fields: id (UUID PK), walletAddress (unique, VarChar 255), firstSeenAt (DateTime default now), lastSeenAt (DateTime default now), sponsorshipCount (Int default 0), isBlocked (Boolean default false), blockReason (optional VarChar 500). Map to `wallets` table. Include relation to SponsorshipRequest[].
    - _Requirements: 2.1, 2.5_

  - [x] 2.4 Add `SponsorshipRequest` model with fields: id (UUID PK), walletId (FK), status (enum default pending), eligibilityReason (optional VarChar 500), requestedAt (DateTime default now), approvedAt (optional DateTime), rejectedAt (optional DateTime), completedAt (optional DateTime), failedAt (optional DateTime), ipAddress (optional VarChar 45), userAgent (optional VarChar 1024). Relation to Wallet with onDelete Restrict. Relation to RelayTransaction[]. Map to `sponsorship_requests` table.
    - _Requirements: 2.2, 2.5, 2.6_

  - [x] 2.5 Add `RelayTransaction` model with fields: id (UUID PK), sponsorshipRequestId (FK), transactionHash (unique optional VarChar 255), status (enum default queued), relayAttempt (Int default 1), submittedAt (optional DateTime), confirmedAt (optional DateTime), failedAt (optional DateTime), failureReason (optional VarChar 1000). Relation to SponsorshipRequest with onDelete Restrict. Map to `relay_transactions` table.
    - _Requirements: 2.3, 2.6_

  - [x] 2.6 Add `RateLimit` model with fields: id (UUID PK), identifier (VarChar 255), identifierType (enum), requestCount (Int default 0), windowStart (DateTime default now), blockedUntil (optional DateTime). Add composite index on `[identifier, identifierType]`. Map to `rate_limits` table.
    - _Requirements: 2.4, 2.9_

- [x] 3. Implement singleton client and package entry
  - [x] 3.1 Create `packages/shared/src/db.ts` implementing `validateDatabaseUrl()` function that throws an error (including "DATABASE_URL" and expected format in message) if the env var is unset, empty, or whitespace-only. Implement `createPrismaClient()` using the validated URL. Export `prisma` singleton using `globalThis` pattern (only cache on globalThis in non-production).
    - _Requirements: 1.4, 1.7, 4.2, 4.6, 5.4_

  - [x] 3.2 Create `packages/shared/src/index.ts` that re-exports `prisma` from `./db` and re-exports all types/enums from `@prisma/client`
    - _Requirements: 4.1, 4.5_

  - [ ]* 3.3 Write property test for DATABASE_URL validation (Property 1)
    - **Property 1: DATABASE_URL validation rejects all invalid values**
    - Use `fast-check` to generate undefined, empty, and whitespace-only strings
    - Assert `validateDatabaseUrl()` throws with message containing "DATABASE_URL"
    - File: `packages/shared/tests/db.property.test.ts`
    - **Validates: Requirements 1.7, 4.6, 5.4**

  - [ ]* 3.4 Write property test for wallet address normalization (Property 2)
    - **Property 2: Wallet address normalization is idempotent lowercase**
    - Use `fast-check` with `fc.string()` and `fc.hexaString()` generators
    - Assert `normalize(input) === input.toLowerCase()` and `normalize(normalize(input)) === normalize(input)`
    - File: `packages/shared/tests/db.property.test.ts`
    - **Validates: Requirements 2.8**

- [x] 4. Checkpoint - Verify schema and client
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add unit and smoke tests
  - [x] 5.1 Write unit tests for singleton behavior and exports in `packages/shared/tests/db.unit.test.ts`
    - Test that multiple imports of `prisma` return the same reference
    - Test that package entry exports `prisma` as a named export
    - Test that re-exports include model types and enums (SponsorshipRequestStatus, RelayTransactionStatus, RateLimitIdentifierType)
    - Test that valid DATABASE_URL does not throw
    - _Requirements: 1.4, 1.5, 4.1, 4.2, 4.5_

  - [x] 5.2 Write smoke tests for static configuration in `packages/shared/tests/schema.smoke.test.ts`
    - Verify `schema.prisma` exists at correct path
    - Verify schema contains `env("DATABASE_URL")`
    - Verify `package.json` has correct dependencies and scripts
    - Verify `.env.example` contains placeholder format
    - Verify `.gitignore` excludes `.env`
    - Verify no hardcoded connection strings in source files
    - Verify schema defines all four models and three enums
    - Verify composite index on RateLimit
    - Verify onDelete Restrict on relations
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 2.1–2.9, 3.1, 3.6, 5.1, 5.2, 5.3, 5.5_

- [x] 6. Wire monorepo integration and consumer setup
  - [x] 6.1 Add `@arcpass/shared` as a `workspace:*` dependency in `apps/api/package.json`
    - _Requirements: 4.3, 6.3, 6.4_

  - [x] 6.2 Add `@arcpass/shared` as a `workspace:*` dependency in `apps/worker/package.json` (create `apps/worker/package.json` if it doesn't exist)
    - _Requirements: 4.4, 6.4_

  - [-] 6.3 Run `pnpm install` from workspace root to link the new package and verify workspace resolution
    - _Requirements: 6.1_

- [x] 7. Generate initial migration and validate build
  - [x] 7.1 Run `prisma generate` in `packages/shared` to produce the generated client and verify TypeScript compilation succeeds with `tsc --noEmit`
    - _Requirements: 1.6, 6.2, 6.5_

  - [ ]* 7.2 Write integration test verifying consumer apps can import `prisma` and types from `@arcpass/shared` without internal path references
    - Test: `import { prisma, SponsorshipRequestStatus } from '@arcpass/shared'` resolves correctly
    - _Requirements: 4.3, 4.4, 6.4_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Smoke tests verify static configuration without requiring a database
- Integration tests requiring a live PostgreSQL instance are noted but should run in CI with a service container
- Wallet address normalization (Requirement 2.8) is enforced at the application layer before writes — the normalize utility should be exported from `src/index.ts`
- The `packages/shared` directory already exists in the workspace but is empty — tasks create all files from scratch

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 3, "tasks": ["3.1", "3.2"] },
    { "id": 4, "tasks": ["3.3", "3.4", "5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2"] }
  ]
}
```
