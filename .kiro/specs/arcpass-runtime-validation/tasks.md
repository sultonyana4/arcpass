# Implementation Plan: ArcPass Runtime Validation

## Overview

Create a layered runtime validation suite using Vitest and fast-check that verifies all ArcPass runtime components operate correctly after deployment. Tests are organized in `tests/validation/` with execution order mirroring system startup: environment → database → API → worker → contract → poller → lifecycle → receipt → e2e. Property-based tests validate pure logic independently of infrastructure.

## Tasks

- [x] 1. Set up validation test infrastructure
  - [x] 1.1 Create test directory structure and Vitest configuration
    - Create `tests/validation/` directory and `tests/validation/properties/` subdirectory
    - Create `vitest.config.validation.ts` at project root configured for the `tests/validation/` path
    - Add `fast-check` as a dev dependency if not already present
    - Configure test sequencer to run files in layered order (env → db → api → worker → contract → poller → lifecycle → receipt → e2e)
    - Add a `validate` script to root `package.json` that runs `vitest --run --config vitest.config.validation.ts`
    - _Requirements: 11.1-11.8, Design: Test Organization_

  - [x] 1.2 Create shared test utilities and helpers
    - Create `tests/validation/helpers.ts` with shared utilities: availability check functions (database reachable, API reachable, RPC reachable), polling helper with configurable interval and timeout, environment variable presence check
    - Create `tests/validation/constants.ts` with shared constants: API base URL, RPC URL, timeouts, expected chain ID, contract addresses from env
    - _Requirements: 11.1-11.8, 2.1, 4.1_

- [x] 2. Implement environment configuration validation tests
  - [x] 2.1 Create environment validation test suite
    - Create `tests/validation/env.validation.test.ts`
    - Test that DATABASE_URL is set and starts with `postgresql://`
    - Test that CHAIN_RPC_URL is set and starts with `http://` or `https://`
    - Test that CHAIN_ID is set to `1942999`
    - Test that CONTRACT_ADDRESS_SPONSOR_VAULT matches `^0x[0-9a-fA-F]{40}$`
    - Test that CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY matches `^0x[0-9a-fA-F]{40}$`
    - Test that SPONSOR_PRIVATE_KEY (after stripping optional 0x prefix) matches `^[0-9a-fA-F]{64}$`
    - Test that missing/malformed variables produce a single aggregated error message to stderr
    - Test optional numeric variables (POLL_INTERVAL_MS, BATCH_SIZE, MAX_RETRIES, LOCK_TIMEOUT_MS, SHUTDOWN_TIMEOUT_MS, CONFIRMATION_BLOCKS, TX_TIMEOUT_MS, CHAIN_ID_VERIFY_TIMEOUT_MS) against configured ranges when set
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ]* 2.2 Write property test for URL scheme validation
    - **Property 3: URL Scheme Validation**
    - Test that DATABASE_URL validation accepts strings starting with `postgresql://` or `postgres://` and rejects all others
    - Test that CHAIN_RPC_URL validation accepts strings starting with `http://` or `https://` and rejects all others
    - Use fast-check to generate arbitrary strings and verify accept/reject behavior
    - **Validates: Requirements 11.1, 11.2**

  - [ ]* 2.3 Write property test for contract address format validation
    - **Property 4: Contract Address Format Validation**
    - Test that contract address validation returns true iff string matches `^0x[0-9a-fA-F]{40}$`
    - Use fast-check to generate valid and invalid address strings
    - **Validates: Requirements 11.4, 11.5**

  - [ ]* 2.4 Write property test for private key format validation
    - **Property 5: Private Key Format Validation**
    - Test that after stripping optional "0x" prefix, validation accepts iff remaining is 64 hex chars
    - Use fast-check to generate valid keys with/without prefix and invalid strings
    - **Validates: Requirements 11.6**

  - [ ]* 2.5 Write property test for configuration error aggregation
    - **Property 6: Configuration Error Aggregation**
    - Test that for any non-empty subset of missing/malformed required env vars, loadConfig() produces a single error mentioning every invalid variable name
    - Use fast-check to generate subsets of required variables to omit/malform
    - **Validates: Requirements 11.7**

  - [ ]* 2.6 Write property test for numeric range validation
    - **Property 7: Numeric Range Validation**
    - Test that for each optional numeric env var and any numeric value, range validation accepts values within [min, max] and rejects values outside
    - Use fast-check to generate integers across the full range
    - **Validates: Requirements 11.8**

- [x] 3. Implement database schema validation tests
  - [x] 3.1 Create database schema validation test suite
    - Create `tests/validation/db-schema.validation.test.ts`
    - Gate all tests behind database availability check using `describe.skipIf`
    - Test that tables `wallets`, `sponsorship_requests`, `relay_transactions`, and `rate_limits` exist in PostgreSQL within 30 seconds
    - Test that `relay_transactions.explorerUrl` exists with type VARCHAR(512) and nullable
    - Test that `relay_transactions.blockNumber` exists with type BIGINT and nullable
    - Test that `relay_transactions.eventName` exists with type VARCHAR(100) and nullable
    - Test that `relay_transactions.eventData` exists with type JSONB and nullable
    - Test that composite index on `(walletId, status)` and single-column index on `(walletId)` exist on `sponsorship_requests`
    - Test that enum types `SponsorshipRequestStatus`, `RelayTransactionStatus`, and `RateLimitIdentifierType` exist
    - Test that missing migrations are reported to stderr with non-zero exit
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement API server validation tests
  - [x] 5.1 Create API server validation test suite
    - Create `tests/validation/api.validation.test.ts`
    - Gate all tests behind API availability check using `describe.skipIf`
    - Test that `/health` returns HTTP 200 with `{ status: "ok" }` within 10 seconds
    - Test that POST `/sponsorship/request` with valid `walletAddress` (42-44 chars) returns HTTP 201 with sponsorship request object
    - Test that GET `/sponsorship/:id` with valid UUID returns HTTP 200 with sponsorship request status
    - Test that POST `/sponsorship/request` with invalid/missing `walletAddress` returns HTTP 400 with `error` field
    - Test that API binding failure to port 4000 is detected and logged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 6. Implement worker startup validation tests
  - [x] 6.1 Create worker startup validation test suite
    - Create `tests/validation/worker.validation.test.ts`
    - Gate integration tests behind worker/RPC availability check
    - Test that `loadConfig()` completes without calling `process.exit(1)` and all required env vars pass format validation
    - Test that `createViemClients()` derives a 42-character hex account address from SPONSOR_PRIVATE_KEY
    - Test that `verifyChainId()` receives chain ID 1942999 within configured timeout (default 10000ms, configurable 1000-30000ms)
    - Test that `initializeContractClient()`, `initializeRelayExecutor()`, and `createPoller()` complete without throwing and `poller.start()` begins polling
    - Test that any subsystem failure logs the failing subsystem name and error, and process exits with code 1
    - Test that `verifyChainId()` timeout logs RPC unreachable error and exits with code 1
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 7. Implement contract client validation tests
  - [x] 7.1 Create contract client validation test suite
    - Create `tests/validation/contract.validation.test.ts`
    - Gate tests behind RPC availability check
    - Test that `eth_getCode` for SponsorVault returns bytecode longer than "0x" within 10000ms
    - Test that `eth_getCode` for SponsorshipRegistry returns bytecode longer than "0x" within 10000ms
    - Test that explorer base URL is a valid HTTP/HTTPS URL ending with trailing slash
    - Test that missing bytecode ("0x" or empty) logs error with contract address and exits non-zero
    - Test that RPC timeout (>10000ms) logs bytecode verification timeout and exits non-zero
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 8. Implement poller loop validation tests
  - [x] 8.1 Create poller loop validation test suite
    - Create `tests/validation/poller.validation.test.ts`
    - Gate tests behind database + worker availability
    - Test that first poll cycle completes without unhandled exception and returns a result set within 10 seconds
    - Test that poll query executes against `sponsorship_requests` and `relay_transactions` selecting status 'pending' or 'relayed' with no active relay, limited to batchSize (1-100, default 20)
    - Test that subsequent cycles are scheduled via setTimeout at POLL_INTERVAL_MS (1000-60000ms, default 5000) and new cycle doesn't begin until previous completes
    - Test that database connection error during poll is logged, poller doesn't crash, and next cycle is scheduled
    - Test that single request failure within a batch logs request ID and error, and remaining requests continue processing
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement sponsorship lifecycle validation tests
  - [x] 10.1 Create lifecycle validation test suite
    - Create `tests/validation/lifecycle.validation.test.ts`
    - Gate tests behind full stack availability (API + worker + database)
    - Test that POST `/sponsorship/request` with valid checksummed wallet address returns UUID `id` and status `pending` within 5 seconds
    - Test that polling GET `/sponsorship/:id` at 2-second intervals shows status transition from `pending` through `approved` to `relayed` within 30 seconds
    - Test that status transitions to `completed` with non-empty `transactionHash` within 120 seconds of original request
    - Test that completed request has RelayTransaction with status `confirmed`, non-empty `transactionHash`, and non-null `confirmedAt`
    - Test that `failed` status or 120-second timeout reports `failureReason` and exits non-zero
    - Test that `approved` state is treated as valid intermediate state between `pending` and `relayed`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 10.2 Create transaction hash persistence validation
    - Within `tests/validation/lifecycle.validation.test.ts` or as separate describe block
    - Test that `transactionHash` is a valid 66-character hex string (0x + 64 hex chars, case-insensitive)
    - Test that `transactionHash` is unique across all RelayTransaction records
    - Test that `blockNumber` is a positive integer ≥ 1 when block data is available
    - Test that `confirmedAt` is ≥ `submittedAt` and ≤ current time + 60 seconds
    - Test that AlreadySponsored path leaves `transactionHash` null with status `confirmed`
    - Test that `updateRelayTransaction` failure retains pre-confirmation state and propagates error
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 10.3 Write property test for transaction hash format validation
    - **Property 2: Transaction Hash Format Validation**
    - Test that validation returns true iff string is exactly 66 chars, starts with "0x", remaining 64 chars are valid hex (case-insensitive)
    - Use fast-check to generate valid hashes and arbitrary strings
    - **Validates: Requirements 7.1**

- [x] 11. Implement explorer URL and receipt validation tests
  - [x] 11.1 Create explorer URL validation within lifecycle tests
    - Add assertions to lifecycle validation for explorer URL
    - Test that `explorerUrl` follows pattern `https://testnet.arcscan.io/tx/{transactionHash}` with lowercase hex
    - Test that `explorerUrl` contains the exact `transactionHash` from the same record
    - Test that `explorerUrl` length ≤ 512 characters
    - Test that null `explorerUrl` after `confirmed` status flags validation failure with relay transaction ID
    - Test that `explorerUrl` is exactly base URL + transaction hash with no extra path/query/fragment
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 11.2 Write property test for explorer URL construction
    - **Property 1: Explorer URL Construction Correctness**
    - Test that for any valid tx hash and valid explorer base URL, `buildExplorerUrl` produces a URL that: contains exact tx hash as substring, starts with base URL, has length ≤ 512, contains no query params/fragments/extra path segments
    - Use fast-check to generate valid tx hashes and base URLs
    - **Validates: Requirements 4.3, 8.1, 8.2, 8.3, 8.5**

  - [x] 11.3 Create on-chain receipt validation test suite
    - Create `tests/validation/receipt.validation.test.ts`
    - Gate tests behind RPC availability and completed transaction availability
    - Test that `eth_getTransactionReceipt` returns non-null receipt within 30 seconds
    - Test that receipt status equals `0x1` (success)
    - Test that receipt `blockNumber` is non-null hex string matching `0x` + 1+ hex digits (positive integer)
    - Test that receipt `logs` array contains at least one log with topic matching SponsorshipGranted event signature
    - Test that HTTP/JSON-RPC error reports tx hash and error details, exits non-zero
    - Test that null receipt (unmined) retries at 2-second intervals for max 30 seconds before reporting unconfirmed
    - Test that non-0x1 receipt status reports tx hash and status, exits non-zero
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 12. Implement E2E script validation tests
  - [x] 12.1 Create E2E script runner test suite
    - Create `tests/validation/e2e-script.validation.test.ts`
    - Gate tests behind full stack availability (API + worker + database + RPC)
    - Test that `npx tsx scripts/validate-e2e.ts` with API_BASE_URL, CHAIN_RPC_URL, VALIDATION_WALLET_ADDRESS set exits with code 0 within 180 seconds
    - Test that successful output contains tx hash matching `0x` + 64 hex chars, explorer URL starting with `http://` or `https://`, and positive integer block number
    - Test that explorer URL in output contains the tx hash as substring
    - Test that non-zero exit code fails validation and includes captured stderr
    - Test that missing required env vars (API_BASE_URL, CHAIN_RPC_URL, VALIDATION_WALLET_ADDRESS) causes non-zero exit with stderr indicating which variable is missing
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check (pure logic, no infrastructure needed)
- Integration tests are gated behind availability checks and skip gracefully when services are unavailable
- The existing `scripts/validate-e2e.ts` is reused as-is — no modifications to that script
- All tests use Vitest as the test runner
- Test execution order mirrors system startup: env → db → api → worker → contract → poller → lifecycle → receipt → e2e

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "5.1"] },
    { "id": 4, "tasks": ["6.1", "7.1"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["10.1", "10.2"] },
    { "id": 7, "tasks": ["10.3", "11.1"] },
    { "id": 8, "tasks": ["11.2", "11.3"] },
    { "id": 9, "tasks": ["12.1"] }
  ]
}
```
