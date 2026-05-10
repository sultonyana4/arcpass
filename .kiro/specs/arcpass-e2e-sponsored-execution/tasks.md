# Implementation Plan: ArcPass E2E Sponsored Execution

## Overview

This plan implements the remaining gaps for end-to-end sponsored transaction execution on Arc testnet. The existing worker runtime, Prisma models, relay lifecycle, and contract client are already in place. Tasks focus on: explorer URL generation/persistence, config additions, deterministic retry-safe execution (idempotency guards, AlreadySponsored handling, wallet blocked checks), wallet sponsorshipCount synchronization, stale relay recovery in the poller, graceful shutdown with force-exit, structured logging enhancements, and an integration validation script.

## Tasks

- [x] 1. Add explorerUrl field to Prisma schema and config
  - [x] 1.1 Add `explorerUrl` column to RelayTransaction model and create migration
    - Add `explorerUrl String? @db.VarChar(512)` to the `RelayTransaction` model in `packages/shared/prisma/schema.prisma`
    - Run `npx prisma migrate dev --name add_explorer_url` to generate the migration
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 Add `explorerBaseUrl` to WorkerConfig and config loader
    - Add `explorerBaseUrl: string` field to the `WorkerConfig` interface in `apps/worker/src/config.ts`
    - Parse optional `EXPLORER_BASE_URL` env var with default `https://testnet.arcscan.io/tx/`
    - Implement `normalizeTrailingSlash` helper to ensure trailing slash
    - _Requirements: 1.3, 1.4, 4.5_
  - [ ]* 1.3 Write property test for explorer URL generation and trailing-slash normalization
    - **Property 1: Explorer URL generation with trailing-slash normalization**
    - **Validates: Requirements 1.1, 1.4**
    - Create `apps/worker/tests/property/explorer-url.property.test.ts`
    - Use fast-check to generate arbitrary base URLs (with/without trailing slash) and valid 66-char hex hashes
    - Assert the generated URL equals normalized base + hash

- [x] 2. Update contract-client for explorer URL and enhanced error handling
  - [x] 2.1 Add `explorerUrl` to `ContractRelayResult` and update `initializeContractClient`
    - Add `explorerUrl: string | null` field to `ContractRelayResult` interface in `apps/worker/src/contract-client.ts`
    - Update `initializeContractClient` to accept `configuredExplorerBaseUrl: string` parameter
    - Add module-level `explorerBaseUrl` state variable
    - Implement `buildExplorerUrl(hash: string): string` internal function
    - On successful receipt (`status === 'success'`), set `explorerUrl: buildExplorerUrl(hash)`
    - On failure/revert, set `explorerUrl: null`
    - _Requirements: 1.1, 1.5_
  - [x] 2.2 Enhance error handling for real network conditions
    - Ensure connection timeout/refused errors return `success: false`, `transactionHash: null`, descriptive `failureReason`
    - Ensure nonce-too-low errors include "nonce" in `failureReason`
    - Ensure `waitForTransactionReceipt` timeout returns failure with "Transaction confirmation timeout" and preserves `transactionHash`
    - Ensure gas estimation failures return `success: false`, `transactionHash: null`
    - Ensure HTTP 429 errors return `failureReason` containing "rate limited"
    - Ensure `truncateReason` is applied to all failure reasons before returning
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8_
  - [x] 2.3 Enhance custom error decoding with fallback
    - Ensure `handleExecutionError` decodes known SponsorVault custom errors (AlreadySponsored, ExceedsLimit, etc.) and includes error name in `failureReason`
    - Add fallback for unknown revert errors: store generic "Transaction reverted on-chain" message
    - _Requirements: 3.6, 3.7_
  - [ ]* 2.4 Write property test for failure reason truncation
    - **Property 3: Failure reason truncation**
    - **Validates: Requirements 3.8, 5.3**
    - Create `apps/worker/tests/property/truncation.property.test.ts`
    - Use fast-check to generate arbitrary strings, assert output ≤ 1000 chars, input ≤ 1000 returns unchanged, input > 1000 returns first 997 + "..."
  - [ ]* 2.5 Write property test for custom error decoding
    - **Property 12: Custom error decoding**
    - **Validates: Requirements 3.6**
    - Create `apps/worker/tests/property/error-decoding.property.test.ts`
    - Test that known SponsorVault errors produce failure reasons containing the error name

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update processor with idempotency guards, wallet checks, and sponsorshipCount sync
  - [x] 4.1 Add wallet blocked check to processor
    - After acquiring the row lock and verifying status is `pending`, query the associated wallet's `isBlocked` field
    - If `isBlocked === true`, transition request to `rejected` with `eligibilityReason: 'Wallet is blocked'`
    - Return early without creating a relay transaction
    - _Requirements: 7.4_
  - [x] 4.2 Add existing confirmed relay idempotency guard with completion shortcut
    - When an existing relay with status `confirmed` is found, transition the sponsorship request to `completed` and increment `sponsorshipCount`
    - When an existing relay with status `submitted` is found, skip processing (already in-flight)
    - _Requirements: 2.1, 2.2_
  - [x] 4.3 Add AlreadySponsored error handling
    - Implement `isAlreadySponsoredError(failureReason: string | null): boolean` helper
    - When relay fails with AlreadySponsored, update relay to `confirmed`, transition request to `completed`, increment `sponsorshipCount`
    - _Requirements: 2.5, 7.2_
  - [x] 4.4 Add wallet sponsorshipCount increment on completion
    - On successful relay confirmation, increment `wallet.sponsorshipCount` by 1 within the same `$transaction`
    - Ensure increment happens for both normal confirmation and AlreadySponsored paths
    - Ensure NO increment on `failed` or `rejected` transitions
    - _Requirements: 5.5, 7.1, 7.3_
  - [x] 4.5 Pass explorerUrl through processor to lifecycle
    - Pass `explorerUrl` from `RelayResult` to `updateRelayTransaction` on confirmed status
    - _Requirements: 1.2_
  - [x] 4.6 Pass `relayTransactionId` to `executeRelay` for structured logging
    - Update `executeRelay` call to include `relayTransactionId` parameter
    - Ensure all processor log entries include `sponsorshipRequestId`, `relayTransactionId`, `walletAddress`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 4.7 Write property test for blocked wallet rejection
    - **Property 10: Blocked wallet rejection**
    - **Validates: Requirements 7.4**
    - Create test verifying that pending requests with blocked wallets are rejected without relay creation
  - [ ]* 4.8 Write property test for sponsorship count invariant
    - **Property 11: Sponsorship count invariant**
    - **Validates: Requirements 5.5, 7.1, 7.2, 7.3**
    - Create test verifying count increments only on completed transitions

- [x] 5. Update lifecycle module to persist explorerUrl
  - [x] 5.1 Add `explorerUrl` to `updateRelayTransaction` data parameter
    - Add `explorerUrl?: string | null` to the optional data parameter type in `apps/worker/src/lifecycle.ts`
    - Persist `explorerUrl` in the update when provided
    - Make `MAX_RELAY_ATTEMPTS` configurable (accept from config rather than hardcoded to 3)
    - _Requirements: 1.2, 5.2_
  - [ ]* 5.2 Write property test for relay status transition validity
    - **Property 5: Relay status transition validity**
    - **Validates: Requirements 5.6**
    - Create `apps/worker/tests/property/state-transitions.property.test.ts`
    - Test all pairs from RelayStatus enum, assert only valid transitions return true

- [x] 6. Update relay-executor to pass explorerUrl and accept relayTransactionId
  - [x] 6.1 Update `RelayResult` interface and `executeRelay` signature
    - Add `explorerUrl?: string | null` to `RelayResult` interface in `apps/worker/src/relay-executor.ts`
    - Add `relayTransactionId: string` parameter to `executeRelay` function
    - Pass `relayTransactionId` to `RelayContext` when calling `executeContractRelay`
    - Pass through `explorerUrl` from `ContractRelayResult` to `RelayResult`
    - _Requirements: 1.1, 6.2, 6.3_

- [x] 7. Update poller to include stale relayed requests
  - [x] 7.1 Modify poller query to include stale `relayed` requests
    - Update the SQL query in `apps/worker/src/poller.ts` to include requests where `status = 'relayed'` AND no associated relay transaction has status `submitted` or `confirmed`
    - Maintain `ORDER BY "requestedAt" ASC` and `LIMIT ${config.batchSize}`
    - _Requirements: 9.3_
  - [ ]* 7.2 Write property test for poller query correctness
    - **Property 13: Poller query correctness**
    - **Validates: Requirements 9.3**
    - Test that the query returns exactly pending requests OR relayed requests with no active relay

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement graceful shutdown with force-exit
  - [x] 9.1 Update worker.ts stop() with force-exit on timeout
    - Modify `stop()` in `apps/worker/src/worker.ts` to race poller stop against `SHUTDOWN_TIMEOUT_MS`
    - If timeout fires first, call `process.exit(1)` after disconnecting Prisma
    - Ensure Prisma `$disconnect()` is called only after poller has fully stopped or timeout expires
    - _Requirements: 9.1, 9.2, 9.4_

- [x] 10. Enhance structured logging
  - [x] 10.1 Add relay-stage structured log entries to processor and contract-client
    - Emit `info` log when processor begins processing (include request ID, wallet address, attempt number)
    - Emit `info` log when contract-client broadcasts transaction (include hash, recipient, amount)
    - Emit `info` log on receipt (include outcome, hash, block number, elapsed ms)
    - Emit `info` log on status transitions (include previous/new status, request ID)
    - Emit `error` log on failures (include error message truncated to 1000 chars, request ID, relay stage, elapsed ms)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 10.2 Implement sensitive data filtering in logger
    - Add `filterSensitiveData` function to `apps/worker/src/logger.ts`
    - Redact fields matching sensitive patterns (privatekey, private_key, mnemonic, secret, password, credential, authorization — case-insensitive)
    - Redact credential-bearing URLs (matching `http(s)://user:pass@host`) with `[REDACTED_URL]`
    - Apply filter to all log entries before output
    - _Requirements: 6.6_
  - [x] 10.3 Ensure structured log output format (single-line JSON to stdout/stderr)
    - Verify logger outputs single-line JSON objects with required fields: `timestamp` (ISO 8601), `level`, `component`, `message`
    - Route `info`/`warn` to stdout, `error` to stderr
    - _Requirements: 6.7_
  - [ ]* 10.4 Write property test for sensitive data filtering
    - **Property 6: Sensitive data filtering**
    - **Validates: Requirements 6.6**
    - Create `apps/worker/tests/property/sensitive-filter.property.test.ts`
    - Use fast-check to generate objects with sensitive keys, assert values are redacted
  - [ ]* 10.5 Write property test for structured log output format
    - **Property 7: Structured log output format**
    - **Validates: Requirements 6.7**
    - Create test verifying output is valid single-line JSON with required fields

- [x] 11. Update config validation to report all errors at once
  - [x] 11.1 Refactor config loader to collect and report all validation errors
    - Modify `loadConfig()` in `apps/worker/src/config.ts` to collect all invalid variable names before terminating
    - Log a single error message listing all invalid variables, then exit with non-zero code
    - _Requirements: 4.6_
  - [ ]* 11.2 Write property test for config validation format acceptance/rejection
    - **Property 4: Config validation — format acceptance and rejection**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7**
    - Create `apps/worker/tests/property/config-validation.property.test.ts`
    - Use fast-check to generate valid/invalid values for each env var and assert correct acceptance/rejection

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Wire worker.ts to pass explorerBaseUrl to contract-client
  - [x] 13.1 Update worker.ts `start()` to pass `config.explorerBaseUrl` to `initializeContractClient`
    - Add `config.explorerBaseUrl` as the fourth argument to `initializeContractClient` call
    - _Requirements: 1.1, 1.3, 4.5_

- [x] 14. Create end-to-end validation script
  - [x] 14.1 Create `scripts/validate-e2e.ts` validation script
    - Create the script at `scripts/validate-e2e.ts`
    - Implement `POST /sponsorship/request` with valid wallet address, verify HTTP 201 with `id` (UUID) and `status: 'pending'`
    - Implement polling `GET /sponsorship/:id` every 2s with configurable timeout (default 120s)
    - On `completed`: verify `transactionHash` matches `0x[0-9a-f]{64}`, verify `explorerUrl` contains hash
    - Query `eth_getTransactionReceipt` via RPC to confirm `blockNumber != null` and `status == 1`
    - Output summary: wallet address, request ID, tx hash, explorer URL, block number, elapsed time
    - On `failed`: output `failureReason` to stderr, exit(1)
    - On timeout: output timeout error with last status to stderr, exit(1)
    - On non-201 POST response: output HTTP status and error body to stderr, exit(1)
    - Read config from env vars: `API_BASE_URL`, `CHAIN_RPC_URL`, `VALIDATION_WALLET_ADDRESS`, `VALIDATION_TIMEOUT_MS`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing worker modules (config, processor, poller, lifecycle, contract-client, relay-executor, worker) are being extended, not rewritten
- The validation script (`scripts/validate-e2e.ts`) is the primary demo artifact for the Circle grant

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "5.1", "11.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "5.2", "6.1", "11.2"] },
    { "id": 3, "tasks": ["2.5", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "10.2", "10.3"] },
    { "id": 4, "tasks": ["4.7", "4.8", "7.1", "10.1", "10.4", "10.5"] },
    { "id": 5, "tasks": ["7.2", "9.1", "13.1"] },
    { "id": 6, "tasks": ["14.1"] }
  ]
}
```
