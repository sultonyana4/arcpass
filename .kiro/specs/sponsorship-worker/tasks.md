# Implementation Plan: Sponsorship Worker

## Overview

Implement the background sponsorship processing worker (`apps/worker`) as a standalone TypeScript ESM application within the ArcPass monorepo. The worker polls PostgreSQL for pending sponsorship requests, advances them through the full lifecycle (pending → approved → relayed → completed/failed), uses a mock relay simulator, and ensures retry-safe, duplicate-free processing via row-level locking.

## Tasks

- [x] 1. Set up project structure and configuration
  - [x] 1.1 Initialize `apps/worker` package with TypeScript ESM configuration
    - Create `apps/worker/package.json` with `"type": "module"`, workspace dependency on `@arcpass/shared`, dotenv, and devDependencies for vitest + fast-check
    - Create `apps/worker/tsconfig.json` extending monorepo conventions (ESM, strict mode)
    - Create `apps/worker/vitest.config.ts` with test directory configuration for unit/, property/, and integration/ folders
    - Create directory structure: `src/`, `tests/unit/`, `tests/property/`, `tests/integration/`
    - _Requirements: 8.1, 8.2, 8.3, 8.7_

  - [x] 1.2 Implement `src/config.ts` — environment variable loading and validation
    - Define `WorkerConfig` interface with all fields (databaseUrl, pollIntervalMs, batchSize, maxRetries, relayFailureRate, lockTimeoutMs, shutdownTimeoutMs)
    - Implement `loadConfig()` that reads from `process.env` via dotenv
    - Validate ranges: batchSize [1,100], pollIntervalMs [1000,60000], relayFailureRate [0.0,1.0]
    - Throw descriptive error naming the invalid/missing variable on validation failure
    - Apply defaults: pollIntervalMs=5000, batchSize=20, maxRetries=5, relayFailureRate=0.0, lockTimeoutMs=30000, shutdownTimeoutMs=10000
    - _Requirements: 1.2, 1.5, 8.4_

  - [ ]* 1.3 Write property test for configuration validation (Property 1)
    - **Property 1: Configuration validation accepts only values within permitted ranges**
    - **Validates: Requirements 1.2, 1.5, 8.4**

  - [ ]* 1.4 Write unit tests for `config.ts`
    - Test missing required env vars throw with variable name
    - Test boundary values (min/max of each range)
    - Test defaults applied when optional vars absent
    - _Requirements: 1.2, 1.5, 8.4_

- [x] 2. Implement relay simulator
  - [x] 2.1 Implement `src/relay-simulator.ts` — mock blockchain relay
    - Implement `simulateRelay(sponsorshipRequestId, failureRate?)` returning `RelayResult`
    - Generate transaction hash: `0x` + 8 hex chars derived from request ID + 56 random hex chars
    - Throw error on empty/undefined sponsorship request ID
    - Use configured failure rate (default 0.0) to determine success/failure
    - Return `failureReason` string (1-500 chars) on failure, `transactionHash` on success
    - Ensure execution completes within 100ms
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 2.2 Write property test for relay result structure (Property 5)
    - **Property 5: Relay simulator result structure invariant**
    - **Validates: Requirements 3.1**

  - [ ]* 2.3 Write property test for transaction hash format (Property 6)
    - **Property 6: Successful relay simulation produces a correctly formatted transaction hash**
    - **Validates: Requirements 3.2**

  - [ ]* 2.4 Write property test for deterministic boundary behavior (Property 7)
    - **Property 7: Relay simulator deterministic boundary behavior**
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 2.5 Write property test for relay time bound (Property 13)
    - **Property 13: Relay simulator completes within time bound**
    - **Validates: Requirements 3.3**

  - [ ]* 2.6 Write unit tests for relay simulator
    - Test throws on empty/undefined request ID
    - Test hash format matches `0x[0-9a-f]{64}`
    - Test first 8 hex chars derived from request ID
    - Test failure rate 0.0 always succeeds, 1.0 always fails
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement lifecycle manager
  - [x] 4.1 Implement `src/lifecycle.ts` — status transitions and timestamp management
    - Implement `transitionSponsorshipStatus(tx, requestId, newStatus)` that validates against `VALID_SPONSORSHIP_TRANSITIONS` from `@arcpass/shared`
    - Set appropriate timestamp field on each transition (approvedAt, rejectedAt, completedAt, failedAt) using current UTC time with millisecond precision
    - Preserve all previously set timestamp fields unchanged during transitions
    - Reject invalid transitions and return error without modifying the request
    - _Requirements: 2.5, 2.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 4.2 Implement relay transaction CRUD in `src/lifecycle.ts`
    - Implement `createRelayTransaction(tx, sponsorshipRequestId)` that sets `relayAttempt` to previous highest + 1
    - Implement `updateRelayTransaction(tx, relayTransactionId, status, data?)` with relay transition validation
    - Set `submittedAt` on queued→submitted, `confirmedAt` on submitted→confirmed, `failedAt` on →failed
    - Reject invalid relay transitions and preserve existing state
    - Enforce maximum 3 relay attempts per request
    - Implement `getRetryCount(tx, requestId)` to check processing retry count
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 4.3 Write property test for sponsorship status transitions (Property 3)
    - **Property 3: Sponsorship status transition succeeds if and only if it is in VALID_SPONSORSHIP_TRANSITIONS**
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 4.4 Write property test for relay status transitions (Property 4)
    - **Property 4: Relay transaction status transition succeeds if and only if it is in VALID_RELAY_TRANSITIONS**
    - **Validates: Requirements 4.7**

  - [ ]* 4.5 Write property test for relay attempt numbering (Property 8)
    - **Property 8: Relay attempt numbering is sequential**
    - **Validates: Requirements 4.2**

  - [ ]* 4.6 Write property test for timestamp field correctness (Property 9)
    - **Property 9: Lifecycle transitions set the correct timestamp field**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5**

  - [ ]* 4.7 Write property test for timestamp preservation (Property 10)
    - **Property 10: Lifecycle transitions preserve all previously set timestamps**
    - **Validates: Requirements 7.6**

  - [ ]* 4.8 Write unit tests for lifecycle manager
    - Test relay transaction submittedAt set on submitted transition
    - Test max relay attempts (3) prevents new transaction creation
    - Test consistent clock source within single operation
    - Test ISO 8601 format for all timestamps
    - _Requirements: 4.5, 4.6, 7.4, 7.7_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement processor
  - [x] 6.1 Implement `src/processor.ts` — sponsorship request processing orchestration
    - Implement `processRequest(requestId, config)` that advances a request through the full lifecycle within a single transaction
    - Acquire row-level lock via `SELECT FOR UPDATE SKIP LOCKED`
    - Orchestrate: pending→approved→relayed (create relay TX)→invoke relay simulator→completed/failed
    - Handle non-existent request gracefully (skip without error)
    - Enforce 30-second lock timeout — abort and rollback if exceeded
    - Enforce max retry limit (5) — transition to failed if exceeded
    - Rollback transaction on any database error, leaving request in previous status
    - Catch unhandled exceptions, log with request ID, and return error result
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2, 6.3, 6.6_

  - [ ]* 6.2 Write property test for rollback safety (Property 11)
    - **Property 11: Failed transitions preserve request status (rollback safety)**
    - **Validates: Requirements 6.1**

  - [ ]* 6.3 Write property test for max retry limit (Property 12)
    - **Property 12: Maximum retry limit transitions request to failed**
    - **Validates: Requirements 6.6**

  - [ ]* 6.4 Write unit tests for processor
    - Test handles non-existent request gracefully
    - Test creates relay transaction on approval
    - Test handles relay success path (completed)
    - Test handles relay failure path (failed)
    - Test skips locked requests without error
    - Test rollback on database error
    - Test max retry limit enforcement
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 5.2, 6.1, 6.6_

- [x] 7. Implement poller and worker lifecycle
  - [x] 7.1 Implement `src/poller.ts` — poll cycle scheduling and batch dispatch
    - Implement `createPoller(config)` returning a `Poller` with `start()` and `stop()` methods
    - Query pending requests ordered by `requestedAt` ASC with configurable batch size limit
    - Use `SELECT FOR UPDATE SKIP LOCKED` in the poll query to skip locked rows
    - Dispatch each request to `processRequest` sequentially
    - Log failures from processor, skip failed requests, continue with remaining batch
    - Wait configured poll interval between cycles
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.5_

  - [ ]* 7.2 Write property test for poll ordering (Property 2)
    - **Property 2: Poll query returns requests ordered by requestedAt ascending**
    - **Validates: Requirements 1.1**

  - [x] 7.3 Implement `src/worker.ts` — top-level start/stop lifecycle
    - Implement `start()` that initializes config, Prisma client, and starts poller
    - Implement `stop()` that ceases polling, awaits in-progress job (up to 10s), disconnects Prisma
    - Resolve `start()` when worker is actively processing
    - Resolve `stop()` when all resources are released
    - _Requirements: 8.5, 8.6_

  - [x] 7.4 Implement `src/main.ts` — entry point with signal handling
    - Register SIGTERM and SIGINT handlers that invoke `stop()`
    - Exit with code 0 on successful cleanup
    - Exit with code 1 if cleanup exceeds 10 seconds
    - Call `start()` on module load
    - _Requirements: 6.5, 8.8_

  - [ ]* 7.5 Write unit tests for poller
    - Test poll cycle queries pending requests in correct order
    - Test batch size limiting
    - Test error in one request doesn't block others
    - Test poll interval wait between cycles
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Integration tests and final wiring
  - [ ]* 9.1 Write integration tests for worker lifecycle
    - Test worker polls and processes a batch end-to-end
    - Test graceful shutdown completes within timeout
    - Test worker continues after errors, stops on signal
    - _Requirements: 6.5, 8.5, 8.8_

  - [ ]* 9.2 Write integration tests for locking and duplicate prevention
    - Test SELECT FOR UPDATE SKIP LOCKED prevents duplicate processing
    - Test lock timeout triggers rollback after 30 seconds
    - Test lock released on transaction commit and rollback
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 9.3 Write integration tests for batch processing and retries
    - Test error in one request doesn't affect others in batch
    - Test failed request re-discovered in subsequent poll cycle
    - Test max retry limit reached transitions to failed
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Integration tests require a real PostgreSQL test database
- All source files use TypeScript with ESM module syntax
- The worker imports Prisma client and sponsorship types exclusively from `@arcpass/shared`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "4.8"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["7.2", "7.3"] },
    { "id": 10, "tasks": ["7.4", "7.5"] },
    { "id": 11, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
