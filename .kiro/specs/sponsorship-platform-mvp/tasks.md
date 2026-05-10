# Implementation Plan: Sponsorship Platform MVP

## Overview

This plan implements the ArcPass Sponsorship Platform MVP by layering smart contracts, contract integration, enhanced configuration, new API endpoints, schema migrations, observability improvements, and property-based tests on top of the existing Fastify API, worker, and shared package infrastructure. Tasks are ordered to build foundational pieces first (schema, contracts, config) then integration layers, then API endpoints, and finally wiring and testing.

## Tasks

- [x] 1. Database schema migration and duplicate prevention
  - [x] 1.1 Add new fields to RelayTransaction model in Prisma schema
    - Add `blockNumber BigInt?` field to RelayTransaction model
    - Add `eventName String? @db.VarChar(100)` field to RelayTransaction model
    - Add `eventData Json?` field to RelayTransaction model
    - File: `packages/shared/prisma/schema.prisma`
    - _Requirements: 1.7, 5.3_

  - [x] 1.2 Create partial unique index migration for duplicate sponsorship prevention
    - Create a new Prisma migration with a partial unique index on `sponsorship_requests("walletId") WHERE status IN ('pending', 'approved', 'relayed')`
    - This enforces one non-terminal sponsorship request per wallet at the database level
    - File: `packages/shared/prisma/migrations/<timestamp>_add_relay_fields_and_duplicate_index/migration.sql`
    - _Requirements: 1.9, 9.3_

  - [x] 1.3 Run prisma generate and verify schema compiles
    - Run `pnpm prisma generate` in packages/shared
    - Verify the generated client includes new RelayTransaction fields
    - _Requirements: 1.7, 5.3_

- [x] 2. Smart contracts (Solidity)
  - [x] 2.1 Create contracts directory structure and Foundry project
    - Initialize `contracts/` directory at project root with Foundry (`forge init`)
    - Set up `contracts/src/`, `contracts/test/`, `contracts/script/` directories
    - Configure `foundry.toml` with solidity version 0.8.20+, optimizer settings
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.2 Implement SponsorVault.sol
    - Implement owner/operator access control pattern
    - Implement `sponsorTransfer(address recipient, uint256 amount)` with checks: caller == operator, amount <= perTransactionLimit, balance >= amount, registry.sponsorshipCount(recipient) == 0
    - Implement `setOperator`, `setPerTransactionLimit`, `emergencyWithdraw` (owner-only)
    - Implement custom errors: `Unauthorized()`, `ExceedsLimit(uint256, uint256)`, `InsufficientBalance(uint256, uint256)`, `AlreadySponsored(address)`, `InvalidRecipient()`, `InvalidAmount()`
    - Implement `receive() external payable` for funding
    - Emit `SponsorshipExecuted`, `OperatorUpdated`, `PerTransactionLimitUpdated`, `EmergencyWithdrawal` events
    - File: `contracts/src/SponsorVault.sol`
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8, 4.9, 9.8_

  - [x] 2.3 Implement SponsorshipRegistry.sol
    - Implement `sponsorshipCount` mapping (address → uint256)
    - Implement `recordSponsorship(address recipient, uint256 amount)` restricted to vault address
    - Implement `isSponsored(address wallet)` view function returning bool
    - Emit `SponsorshipGranted(address indexed recipient, uint256 amount, uint256 timestamp)` event
    - File: `contracts/src/SponsorshipRegistry.sol`
    - _Requirements: 4.3, 4.4, 4.5_

  - [ ]* 2.4 Write Foundry fuzz tests for SponsorVault
    - **Property 15: SponsorVault access control**
    - **Property 16: Successful sponsorship transfer and event emission**
    - **Property 18: SponsorVault revert conditions**
    - Fuzz `sponsorTransfer` with random addresses and amounts
    - Fuzz access control with random caller addresses
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.6, 4.7, 4.8, 4.9, 9.8**
    - File: `contracts/test/SponsorVault.t.sol`

  - [ ]* 2.5 Write Foundry fuzz tests for SponsorshipRegistry
    - **Property 17: Registry sponsorship count and isSponsored consistency**
    - Fuzz `recordSponsorship` counting invariant
    - Verify `isSponsored` returns true iff count > 0
    - **Validates: Requirements 4.4, 4.5**
    - File: `contracts/test/SponsorshipRegistry.t.sol`

- [x] 3. Checkpoint - Ensure contracts compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Enhanced worker configuration
  - [x] 4.1 Extend WorkerConfig interface and loadConfig with new environment variables
    - Add `chainId: number` (required, positive integer)
    - Add `contractAddressSponsorVault: \`0x${string}\`` (required, 42-char hex)
    - Add `contractAddressSponsorshipRegistry: \`0x${string}\`` (required, 42-char hex)
    - Add `sponsorshipAmount: bigint` (optional, defaults to `1000000000000000n`)
    - Add `chainIdVerifyTimeoutMs: number` (optional, 1000–30000, default 10000)
    - Validate contract address format (0x + 40 hex chars)
    - Report ALL missing required variables in a single error message
    - File: `apps/worker/src/config.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.7_

  - [x] 4.2 Add chain ID verification at startup
    - Query RPC endpoint for `eth_chainId` using viem's `publicClient.getChainId()`
    - Compare returned chain ID against configured `CHAIN_ID` env var
    - Reject startup with descriptive error if mismatch
    - Enforce connection timeout of 10 seconds (configurable via `CHAIN_ID_VERIFY_TIMEOUT_MS`)
    - File: `apps/worker/src/config.ts` or `apps/worker/src/viem-client.ts`
    - _Requirements: 6.4_

  - [x] 4.3 Add private key cryptographic validation at startup
    - Use viem's `privateKeyToAccount` to validate the key produces a valid secp256k1 curve point
    - Terminate with non-zero exit code if validation fails
    - Log error message without exposing key material
    - File: `apps/worker/src/viem-client.ts`
    - _Requirements: 9.1, 9.2_

  - [ ]* 4.4 Write property tests for config validation
    - **Property 21: Config format validation (RPC URL and private key)**
    - **Validates: Requirements 6.1, 6.2**
    - Generate random strings, verify RPC URL accepts iff starts with http:// or https://
    - Generate random strings, verify private key format accepts iff matches `^(0x)?[0-9a-fA-F]{64}$`
    - File: `apps/worker/tests/config-validation.property.test.ts`

  - [ ]* 4.5 Write property tests for missing env vars reporting
    - **Property 22: Missing environment variables reported completely**
    - **Validates: Requirements 6.7**
    - Generate subsets of required vars, verify error lists all missing names
    - File: `apps/worker/tests/config-validation.property.test.ts`

  - [ ]* 4.6 Write property test for private key cryptographic validation
    - **Property 27: Private key cryptographic validation**
    - **Validates: Requirements 9.1, 9.2**
    - Generate invalid key strings, verify startup rejection without key exposure
    - File: `apps/worker/tests/config-validation.property.test.ts`

- [x] 5. Contract integration layer (worker)
  - [x] 5.1 Implement contract-client.ts module
    - Create `apps/worker/src/contract-client.ts`
    - Implement `initializeContractClient(clients, contractConfig, timeoutMs)` function
    - Implement `executeContractRelay(recipientAddress, amount)` function
    - Use viem's `writeContract` to call `SponsorVault.sponsorTransfer`
    - Wait for receipt with configured confirmations via `waitForTransactionReceipt`
    - Extract `SponsorshipGranted` event from receipt logs via `decodeEventLog`
    - Decode revert reasons on failure via `decodeErrorResult`
    - Enforce timeout and return structured `ContractRelayResult`
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7_

  - [x] 5.2 Generate contract ABIs for use in viem
    - After contracts compile, copy ABI JSON artifacts to `apps/worker/src/abis/` directory
    - Export typed ABI constants for SponsorVault and SponsorshipRegistry
    - Files: `apps/worker/src/abis/SponsorVault.json`, `apps/worker/src/abis/SponsorshipRegistry.json`
    - _Requirements: 5.6_

  - [ ]* 5.3 Write property tests for event extraction
    - **Property 19: Event extraction from transaction receipt**
    - **Validates: Requirements 5.2**
    - Generate mock receipts with valid SponsorshipGranted event logs
    - Verify extraction produces correct recipient, amount, timestamp
    - File: `apps/worker/tests/contract-client.property.test.ts`

  - [ ]* 5.4 Write property tests for revert reason decoding
    - **Property 20: Revert reason decoding**
    - **Validates: Requirements 5.4, 5.5**
    - Generate encoded custom errors (Unauthorized, ExceedsLimit, InsufficientBalance, AlreadySponsored)
    - Verify decoding produces correct error name and parameters
    - File: `apps/worker/tests/contract-client.property.test.ts`

- [x] 6. Refactor relay executor to use contract client
  - [x] 6.1 Refactor executeRelay to delegate to contract client
    - Replace direct `walletClient.sendTransaction` call with `executeContractRelay`
    - Preserve existing `executeRelay` function signature for backward compatibility with processor
    - Map `ContractRelayResult` fields (eventData, blockNumber) to `RelayResult`
    - File: `apps/worker/src/relay-executor.ts`
    - _Requirements: 5.1, 5.3_

  - [x] 6.2 Update processor to persist new relay fields
    - When relay succeeds, persist `blockNumber`, `eventName`, and `eventData` on the RelayTransaction record
    - Use the event data extracted by the contract client
    - File: `apps/worker/src/processor.ts`
    - _Requirements: 1.7, 5.3_

  - [x] 6.3 Update lifecycle.ts to support new relay transaction fields
    - Extend `updateRelayTransaction` to accept optional `blockNumber`, `eventName`, `eventData` in the data parameter
    - Persist these fields when provided
    - File: `apps/worker/src/lifecycle.ts`
    - _Requirements: 5.3_

- [x] 7. Checkpoint - Ensure worker compiles and existing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Observability enhancements
  - [x] 8.1 Extend logger component type to include 'contract-client'
    - Add `'contract-client'` to the `LogEntry['component']` union type
    - File: `apps/worker/src/logger.ts`
    - _Requirements: 7.1, 7.2_

  - [x] 8.2 Add correlation ID (sponsorshipRequestId) to all lifecycle log entries
    - Ensure every log entry emitted during sponsorship processing includes `sponsorshipRequestId`
    - Verify existing processor and lifecycle logs already include it; add where missing
    - Files: `apps/worker/src/processor.ts`, `apps/worker/src/lifecycle.ts`, `apps/worker/src/contract-client.ts`
    - _Requirements: 7.5_

  - [x] 8.3 Add relay execution structured log entries
    - Log relay attempt with: sponsorshipRequestId, relayAttempt, transactionHash (when available), outcome (confirmed/reverted/error), failureReason
    - Log elapsed time in milliseconds since relay was submitted on failure
    - Files: `apps/worker/src/contract-client.ts`, `apps/worker/src/relay-executor.ts`
    - _Requirements: 7.2, 7.4_

  - [x] 8.4 Add invalid transition warning logs
    - When a sponsorship status transition is rejected, emit a warn-level log with sponsorshipRequestId, attempted previous status, attempted new status, and rejection reason
    - File: `apps/worker/src/lifecycle.ts`
    - _Requirements: 7.7_

  - [ ]* 8.5 Write property tests for log completeness
    - **Property 23: Structured lifecycle log completeness**
    - **Validates: Requirements 7.1, 7.5**
    - Generate transitions, capture log output, verify JSON structure and required fields
    - File: `apps/worker/tests/log-completeness.property.test.ts`

  - [ ]* 8.6 Write property tests for log stream routing
    - **Property 24: Log stream routing**
    - **Validates: Requirements 7.6**
    - Generate log entries at various levels, verify error→stderr, others→stdout
    - File: `apps/worker/tests/log-completeness.property.test.ts`

  - [ ]* 8.7 Write property tests for invalid transition warning
    - **Property 25: Invalid transition warning log**
    - **Validates: Requirements 7.7**
    - Generate invalid transitions, verify warn-level log with correct fields
    - File: `apps/worker/tests/log-completeness.property.test.ts`

- [x] 9. New API endpoints
  - [x] 9.1 Implement wallet history endpoint (GET /wallets/:address/history)
    - Add cursor-based pagination with default page size 50, max 100
    - Return sponsorship requests ordered by requestedAt descending
    - Return pagination metadata: cursor, hasMore, limit
    - Validate wallet address format, return 404 if wallet not found
    - Files: `apps/api/src/routes/wallets.js`, `apps/api/src/services/wallet.service.js`
    - _Requirements: 2.2, 3.3_

  - [x] 9.2 Implement relay details endpoint (GET /relay/:id)
    - Return relay transaction by UUID: id, sponsorshipRequestId, status, relayAttempt, transactionHash, submittedAt, confirmedAt, failedAt, failureReason
    - Return 404 if not found
    - Create new route file or add to existing sponsorship routes
    - Files: `apps/api/src/routes/relay.js`, `apps/api/src/services/relay.service.js`
    - _Requirements: 3.4_

  - [x] 9.3 Implement transaction hash lookup endpoint (GET /sponsorship/tx/:hash)
    - Look up relay transaction by transactionHash, return associated sponsorship request and relay details
    - Validate hash format (string up to 255 chars)
    - Return 404 if no matching transaction found
    - Files: `apps/api/src/routes/sponsorship.js`, `apps/api/src/services/relay.service.js`
    - _Requirements: 3.5_

  - [x] 9.4 Enhance existing GET /sponsorship/:id to include relay transaction details
    - Include associated relay transactions in the response (status, attempt, hash, timestamps)
    - File: `apps/api/src/services/sponsorship.service.js`
    - _Requirements: 3.2_

  - [x] 9.5 Register new relay routes in server.js
    - Import and register relay routes with appropriate prefix
    - File: `apps/api/src/server.js`
    - _Requirements: 3.4_

  - [ ]* 9.6 Write property tests for pagination ordering
    - **Property 8: Wallet history pagination ordering and completeness**
    - **Validates: Requirements 2.2, 3.3**
    - Generate N requests with random timestamps, verify sort order and no gaps
    - File: `apps/api/tests/pagination.property.test.js`

  - [ ]* 9.7 Write property tests for transaction hash lookup round-trip
    - **Property 12: Transaction hash lookup round-trip**
    - **Validates: Requirements 3.5**
    - Create sponsorship with confirmed relay, verify lookup returns correct data
    - File: `apps/api/tests/tx-lookup.property.test.js`

- [ ] 10. Shared package property tests (state machine)
  - [ ]* 10.1 Write property tests for sponsorship status transitions
    - **Property 1: Sponsorship status transition validity**
    - **Validates: Requirements 1.1, 1.3, 1.4**
    - Generate all (status, status) pairs, verify transition succeeds iff in allowed set
    - Verify error contains both current and attempted status on invalid transitions
    - File: `packages/shared/tests/sponsorship-transitions.property.test.ts`

  - [ ]* 10.2 Write property tests for relay status transitions
    - **Property 2: Relay status transition validity**
    - **Validates: Requirements 1.2, 1.3, 1.4**
    - Generate all (status, status) pairs, verify transition succeeds iff in allowed set
    - File: `packages/shared/tests/relay-transitions.property.test.ts`

- [ ] 11. Worker lifecycle property tests
  - [ ]* 11.1 Write property tests for transition timestamps
    - **Property 3: Transition timestamps are set on valid transitions**
    - **Validates: Requirements 1.5**
    - Generate valid transitions, verify corresponding timestamp field is set to non-null
    - File: `apps/worker/tests/lifecycle.property.test.ts`

  - [ ]* 11.2 Write property tests for retry eligibility
    - **Property 6: Retry eligibility evaluation**
    - **Validates: Requirements 1.10, 9.6**
    - Generate (attemptCount, maxRetries) pairs, verify correct retry/fail behavior
    - File: `apps/worker/tests/lifecycle.property.test.ts`

- [ ] 12. API property tests (validation, errors, rate limiting)
  - [ ]* 12.1 Write property tests for address format validation
    - **Property 11: Input format validation (addresses)**
    - **Validates: Requirements 3.1, 6.3, 9.4**
    - Generate random strings, verify validation accepts iff matches `^0x[0-9a-fA-F]{40}$`
    - File: `apps/api/tests/wallet-validation.property.test.js`

  - [ ]* 12.2 Write property tests for error response shape
    - **Property 13: Error response shape consistency**
    - **Validates: Requirements 3.8, 9.9**
    - Generate various error types, verify response contains {error, statusCode} only
    - File: `apps/api/tests/error-response.property.test.js`

  - [ ]* 12.3 Write property tests for JSON schema validation
    - **Property 14: JSON Schema validation rejects invalid input**
    - **Validates: Requirements 3.9**
    - Generate invalid request bodies, verify 400 without service invocation
    - File: `apps/api/tests/error-response.property.test.js`

  - [ ]* 12.4 Write property tests for rate limit enforcement
    - **Property 26: Rate limit enforcement**
    - **Validates: Requirements 9.5, 2.7**
    - Generate request sequences exceeding limits, verify 429 responses
    - File: `apps/api/tests/rate-limit.property.test.js`

  - [ ]* 12.5 Write property tests for duplicate sponsorship prevention
    - **Property 5: Duplicate sponsorship prevention**
    - **Validates: Requirements 1.9, 9.3**
    - Generate wallets with non-terminal requests, verify rejection of new requests
    - File: `apps/api/tests/duplicate-prevention.property.test.js`

- [x] 13. Docker Compose and environment updates
  - [x] 13.1 Update .env.example with new environment variables
    - Add `CHAIN_ID` with comment and placeholder
    - Add `CONTRACT_ADDRESS_SPONSOR_VAULT` with comment and placeholder
    - Add `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY` with comment and placeholder
    - Add `SPONSORSHIP_AMOUNT_WEI` with comment and default value
    - Add `CHAIN_ID_VERIFY_TIMEOUT_MS` with comment and default value
    - File: `.env.example`
    - _Requirements: 8.5_

  - [x] 13.2 Update docker-compose.yml worker environment with new variables
    - Add new env vars to worker service environment section (with placeholder values)
    - Preserve all existing service definitions, ports, volumes, healthchecks
    - File: `docker-compose.yml`
    - _Requirements: 8.1, 8.5_

  - [x] 13.3 Verify Docker Compose compatibility
    - Ensure existing service definitions (worker, postgres) are unchanged
    - Ensure existing ports, volumes, healthchecks, depends_on are preserved
    - Ensure monorepo workspace structure (apps/api, apps/worker, packages/shared) is intact
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6_

- [x] 14. Integration wiring and final verification
  - [x] 14.1 Wire contract client initialization into worker startup
    - Import and call `initializeContractClient` in worker main/startup after config validation
    - Pass viem clients, contract config (addresses, ABIs), and timeout
    - File: `apps/worker/src/index.ts` or `apps/worker/src/main.ts`
    - _Requirements: 5.1, 5.6_

  - [x] 14.2 Update worker startup sequence to include chain ID verification
    - Call chain ID verification after viem client initialization
    - Terminate with descriptive error if mismatch
    - File: `apps/worker/src/index.ts` or `apps/worker/src/main.ts`
    - _Requirements: 6.4_

  - [x] 14.3 Ensure relay executor initialization uses new config fields
    - Pass `sponsorshipAmount` from config to contract client
    - Ensure contract addresses are passed from config
    - File: `apps/worker/src/relay-executor.ts`
    - _Requirements: 6.5_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Smart contract tests use Foundry's built-in fuzzing for Solidity properties (15–18)
- TypeScript/JavaScript property tests use fast-check library
- The API layer uses JavaScript (ES modules), the worker uses TypeScript, contracts use Solidity
- Existing Docker Compose compatibility is preserved throughout (Requirement 8)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "2.4", "2.5", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "5.2"] },
    { "id": 4, "tasks": ["5.1", "10.1", "10.2"] },
    { "id": 5, "tasks": ["5.3", "5.4", "6.1", "6.3"] },
    { "id": 6, "tasks": ["6.2", "8.1", "8.4", "9.1", "9.2", "9.3"] },
    { "id": 7, "tasks": ["8.2", "8.3", "9.4", "9.5", "13.1"] },
    { "id": 8, "tasks": ["8.5", "8.6", "8.7", "9.6", "9.7", "11.1", "11.2", "13.2"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "13.3"] },
    { "id": 10, "tasks": ["14.1", "14.2", "14.3"] }
  ]
}
```
