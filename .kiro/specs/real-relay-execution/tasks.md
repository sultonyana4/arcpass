# Implementation Plan: Real Relay Execution

## Overview

Replace the mock `relay-simulator.ts` in `apps/worker` with a production-ready blockchain relay executor powered by viem. The implementation proceeds incrementally: configuration updates → viem client factory → structured logger → relay executor → processor integration → shutdown updates → property-based tests. Each step builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Update configuration and add viem dependency
  - [x] 1.1 Add viem as a pinned production dependency in `apps/worker/package.json`
    - Add `"viem": "2.31.3"` (or latest stable) to `dependencies`
    - Run `pnpm install` to update lockfile
    - Verify `pnpm install --frozen-lockfile` succeeds
    - _Requirements: 11.4, 11.7_

  - [x] 1.2 Update `apps/worker/src/config.ts` to add new environment variables and remove `relayFailureRate`
    - Add `chainRpcUrl: string` (required, validated as HTTP/HTTPS URL)
    - Add `sponsorPrivateKey: string` (required, validated as 64-char hex with optional `0x` prefix)
    - Add `confirmationBlocks: number` (default 2, range 1–50)
    - Add `txTimeoutMs: number` (default 120000, range 10000–600000)
    - Remove `relayFailureRate` field and its parsing/validation
    - Add range validation for `lockTimeoutMs` (5000–120000) and `shutdownTimeoutMs` (5000–60000) and `maxRetries` (1–10)
    - Validate all required vars first; missing → `process.exit(1)` with identifying message
    - Validate URL format for `chainRpcUrl` (must start with `http://` or `https://`)
    - Validate hex format for `sponsorPrivateKey` (64-char hex, optional `0x` prefix)
    - Update `WorkerConfig` interface to reflect new fields
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ]* 1.3 Write property test for configuration validation (Property 1)
    - **Property 1: Configuration validation rejects invalid inputs and accepts valid inputs**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6, 3.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**
    - Create `apps/worker/tests/property/config-validation.property.test.ts`
    - Generate random strings for URLs, hex keys, numeric values in/out of range
    - Verify invalid inputs are rejected with identifying error messages
    - Verify valid inputs within format and range are accepted

- [x] 2. Checkpoint - Ensure configuration builds and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Create structured logger module
  - [x] 3.1 Create `apps/worker/src/logger.ts` with structured JSON logging
    - Implement `LogEntry` interface with `timestamp`, `level`, `component`, `message`, and extensible fields
    - Implement `createLogger(component)` factory returning a `Logger` with `info`, `warn`, `error` methods
    - Output single-line JSON via `JSON.stringify` (no pretty-printing)
    - Implement sensitive data filter: strip fields matching patterns for private keys, mnemonics, credential-bearing URLs before serialization
    - Set `component` field at logger creation time
    - _Requirements: 10.6, 10.7, 10.8_

  - [ ]* 3.2 Write property test for structured log format compliance (Property 6)
    - **Property 6: Structured log format compliance**
    - **Validates: Requirements 10.6, 10.7**
    - Create `apps/worker/tests/property/logger.property.test.ts`
    - Generate random log messages, data payloads, component values
    - Verify every log entry is valid single-line JSON with required fields

  - [ ]* 3.3 Write property test for sensitive data filtering (Property 7)
    - **Property 7: No sensitive data in log output**
    - **Validates: Requirements 10.8, 3.4**
    - Create `apps/worker/tests/property/logger-security.property.test.ts`
    - Generate random private keys, URLs with credentials, log scenarios
    - Verify no log output contains private key values, mnemonics, or full credential-bearing URLs

- [x] 4. Create viem client factory
  - [x] 4.1 Create `apps/worker/src/viem-client.ts` with client factory function
    - Implement `ViemClients` interface with `publicClient`, `walletClient`, `account`
    - Implement `createViemClients(config)` function
    - Use `http` transport from viem
    - Derive account from private key using `privateKeyToAccount`
    - Do not hardcode chain definition — use RPC's reported chain ID
    - Validate private key cryptographically via `privateKeyToAccount` (throws on invalid curve point)
    - _Requirements: 2.1, 3.1, 3.3, 3.6_

  - [ ]* 4.2 Write unit tests for viem client creation
    - Create `apps/worker/tests/unit/viem-client.test.ts`
    - Test client creation with valid config
    - Test error on invalid private key
    - _Requirements: 3.1, 3.3_

- [x] 5. Implement relay executor
  - [x] 5.1 Create `apps/worker/src/relay-executor.ts` as drop-in replacement for `relay-simulator.ts`
    - Export `RelayResult` interface (extended with optional `blockNumber?: bigint | null`)
    - Export `executeRelay(sponsorshipRequestId: string, _failureRate?: number): Promise<RelayResult>`
    - Query sponsorship request to resolve target wallet address
    - Construct native token transfer transaction (`value` = configured amount, `to` = wallet address)
    - Call `walletClient.sendTransaction(...)` for atomic sign + broadcast
    - Call `publicClient.waitForTransactionReceipt({ hash, confirmations, timeout })`
    - Map receipt status to RelayResult (success/reverted)
    - Catch all errors and return structured failure (never throw)
    - Use structured logger for broadcast, confirmation, and failure events
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 10.1, 10.2, 10.3_

  - [ ]* 5.2 Write property test for RPC error handling (Property 2)
    - **Property 2: RPC errors produce structured failure results without throwing**
    - **Validates: Requirements 1.5, 4.5**
    - Add to `apps/worker/tests/property/relay-executor.property.test.ts`
    - Generate random error messages and error types
    - Verify all RPC errors produce `RelayResult { success: false }` without throwing

  - [ ]* 5.3 Write property test for receipt status mapping (Property 8)
    - **Property 8: Transaction receipt status maps to correct RelayResult**
    - **Validates: Requirements 4.2, 4.3**
    - Add to `apps/worker/tests/property/relay-executor.property.test.ts`
    - Generate random transaction hashes, block numbers, receipt statuses
    - Verify success receipts map to `{ success: true, transactionHash, blockNumber }`
    - Verify reverted receipts map to `{ success: false, transactionHash, failureReason: 'transaction reverted' }`

  - [ ]* 5.4 Write property test for timeout with pending hash (Property 9)
    - **Property 9: Timeout failure includes pending hash when available**
    - **Validates: Requirements 8.3, 4.4**
    - Add to `apps/worker/tests/property/relay-executor.property.test.ts`
    - Generate random hashes and timeout scenarios (pre/post broadcast)
    - Verify timeout after hash obtained includes hash in failure result
    - Verify timeout before hash obtained returns `transactionHash: null`

- [x] 6. Checkpoint - Ensure relay executor builds and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update processor to use relay executor
  - [x] 7.1 Update `apps/worker/src/processor.ts` to import and use `executeRelay`
    - Replace `import { simulateRelay } from './relay-simulator.js'` with `import { executeRelay } from './relay-executor.js'`
    - Remove `config.relayFailureRate` usage from relay invocation
    - Add guard: check for existing `submitted` or `confirmed` RelayTransaction before creating a new one
    - Handle extended `RelayResult` (with `blockNumber`)
    - Persist `submittedAt` timestamp on RelayTransaction before invoking relay executor
    - Replace all `console.*` calls with structured logger
    - Ensure all transitions remain within a single Prisma `$transaction`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.5_

  - [ ]* 7.2 Write property test for lifecycle state transitions (Property 3)
    - **Property 3: Relay result drives correct lifecycle state transitions**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 7.1**
    - Create `apps/worker/tests/property/processor-lifecycle.property.test.ts`
    - Generate random RelayResults (success/failure), transaction hashes, failure reasons
    - Verify success results transition to confirmed/completed with correct timestamps
    - Verify failure results transition to failed with correct timestamps

  - [ ]* 7.3 Write property test for guard conditions (Property 4)
    - **Property 4: Guard conditions prevent relay invocation**
    - **Validates: Requirements 6.3, 6.4, 7.2, 7.3, 7.5**
    - Create `apps/worker/tests/property/processor-guards.property.test.ts`
    - Generate random request states, retry counts, existing relay statuses
    - Verify relay is skipped when status is not pending, when submitted/confirmed relay exists, or when maxRetries exceeded

- [x] 8. Update worker startup and poller
  - [x] 8.1 Update `apps/worker/src/worker.ts` to initialize viem clients and validate config at startup
    - Call `createViemClients(config)` after `loadConfig()`
    - Log derived sponsor wallet public address at startup (without private key)
    - Log chain RPC URL domain (hostname only, no credentials) at startup
    - Replace `console.*` calls with structured logger
    - Pass viem clients to relay executor module (module-level initialization or dependency injection)
    - _Requirements: 3.1, 3.5, 3.6, 10.4_

  - [x] 8.2 Update `apps/worker/src/poller.ts` to use structured logger
    - Replace all `console.*` calls with structured logger
    - Maintain existing `setTimeout`-based polling architecture unchanged
    - _Requirements: 10.6, 11.5_

  - [x] 8.3 Update `apps/worker/src/main.ts` shutdown to use `shutdownTimeoutMs` from config
    - Use configured `shutdownTimeoutMs` instead of hardcoded 10000
    - Log warning with request ID on forced shutdown timeout
    - Replace `console.*` calls with structured logger
    - _Requirements: 9.3, 9.4, 11.6_

  - [ ]* 8.4 Write property test for batch processing resilience (Property 5)
    - **Property 5: Batch processing continues after individual request failures**
    - **Validates: Requirements 9.1, 9.5**
    - Create `apps/worker/tests/property/poller-batch.property.test.ts`
    - Generate random batch sizes with random failure positions
    - Verify all batch items are attempted regardless of individual failures

- [x] 9. Checkpoint - Ensure full worker builds and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Clean up and finalize
  - [x] 10.1 Remove `apps/worker/src/relay-simulator.ts` and update any remaining references
    - Delete the relay-simulator module
    - Remove or update `apps/worker/tests/unit/relay-simulator.test.ts`
    - Verify no remaining imports of `relay-simulator` in the codebase
    - _Requirements: 1.6, 12.7_

  - [x] 10.2 Verify Docker build compatibility
    - Ensure `tsc` compiles without errors (output at `dist/main.js`)
    - Verify ESM-only architecture (no `require()` calls introduced)
    - Verify `entrypoint.sh` still works with `node --import dotenv/config dist/main.js`
    - Confirm no native compilation dependencies added
    - _Requirements: 11.1, 11.2, 11.3, 11.7_

  - [ ]* 10.3 Write integration test for relay lifecycle flow
    - Create `apps/worker/tests/integration/relay-lifecycle.integration.test.ts`
    - Test full flow with real Prisma against test DB, mocked viem
    - Verify state transitions from pending through completed/failed
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 11. Final checkpoint - Ensure all tests pass and build succeeds
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The relay executor is designed as a drop-in replacement — the processor swap is a single import change
- viem is ESM-native and tree-shakeable, compatible with the existing module architecture
- All blockchain errors are caught and returned as structured `RelayResult` failures — no unhandled exceptions propagate

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "8.1", "8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3"] }
  ]
}
```
