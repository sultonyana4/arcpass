# Requirements Document

## Introduction

This specification defines runtime validation requirements for the ArcPass sponsored execution environment. The goal is to verify that the live runtime — PostgreSQL database, API server, worker process, contract client, and end-to-end sponsorship flow — operates correctly after the E2E sponsored execution implementation.

This is a validation-only spec. No new features, architecture changes, infrastructure additions, or refactors are in scope. All validation tasks reuse existing infrastructure and the existing `validate-e2e.ts` script.

## Glossary

- **Runtime_Validator**: The set of validation checks and scripts that verify ArcPass runtime correctness
- **Prisma_Schema**: The declarative schema at `packages/shared/prisma/schema.prisma` defining database models
- **PostgreSQL_Database**: The PostgreSQL 16 instance running the `arcpass_dev` database
- **API_Server**: The Fastify server (`apps/api`) listening on port 4000 serving sponsorship routes
- **Worker_Process**: The TypeScript worker (`apps/worker`) that polls for pending requests and relays transactions
- **Contract_Client**: The module (`apps/worker/src/contract-client.ts`) that calls SponsorVault.sponsorTransfer on Arc testnet
- **Poller**: The setTimeout-based loop (`apps/worker/src/poller.ts`) that queries pending sponsorship requests
- **Relay_Executor**: The module (`apps/worker/src/relay-executor.ts`) that orchestrates on-chain relay execution
- **Explorer_URL**: A URL of the form `https://testnet.arcscan.io/tx/{txHash}` stored on RelayTransaction records
- **Arc_Testnet**: The Arc Network test chain with chain ID 1942999
- **Validate_E2E_Script**: The existing script at `scripts/validate-e2e.ts` that exercises the full sponsorship flow

## Requirements

### Requirement 1: Database Schema Validation

**User Story:** As a platform operator, I want to verify that the PostgreSQL runtime schema matches the Prisma schema definition, so that I can confirm migrations applied correctly.

#### Acceptance Criteria

1. WHEN `prisma migrate deploy` completes, THE Runtime_Validator SHALL confirm that the tables `wallets`, `sponsorship_requests`, `relay_transactions`, and `rate_limits` exist in PostgreSQL_Database within 30 seconds of validation start
2. WHEN the `relay_transactions` table is inspected, THE Runtime_Validator SHALL confirm that the `explorerUrl` column exists with type VARCHAR(512) and nullable constraint
3. WHEN the `relay_transactions` table is inspected, THE Runtime_Validator SHALL confirm that column `blockNumber` exists with type BIGINT and nullable constraint, column `eventName` exists with type VARCHAR(100) and nullable constraint, and column `eventData` exists with type JSONB and nullable constraint
4. WHEN the `sponsorship_requests` table is inspected, THE Runtime_Validator SHALL confirm that a composite index on columns `(walletId, status)` and a single-column index on `(walletId)` exist
5. IF a migration has not been applied, THEN THE Runtime_Validator SHALL output the missing migration name to stderr and exit with a non-zero status code
6. WHEN `prisma migrate deploy` completes, THE Runtime_Validator SHALL confirm that the enum types `SponsorshipRequestStatus`, `RelayTransactionStatus`, and `RateLimitIdentifierType` exist in PostgreSQL_Database

### Requirement 2: API Server Startup Validation

**User Story:** As a platform operator, I want to verify that the API server starts and responds to requests, so that I can confirm the service is operational.

#### Acceptance Criteria

1. WHEN the API_Server process starts, THE Runtime_Validator SHALL confirm that the `/health` endpoint returns HTTP 200 with a JSON body containing `status` equal to `"ok"` within 10 seconds
2. WHILE the API_Server is running, WHEN a POST request is sent to `/sponsorship/request` with a JSON body containing a `walletAddress` string of 42 to 44 characters, THE Runtime_Validator SHALL confirm that the server responds with HTTP 201 and a JSON body containing a sponsorship request object
3. WHILE the API_Server is running, WHEN a GET request is sent to `/sponsorship/:id` with a valid UUID path parameter, THE Runtime_Validator SHALL confirm that the server responds with HTTP 200 and a JSON body containing the sponsorship request status
4. IF the API_Server fails to bind to port 4000, THEN THE Runtime_Validator SHALL log an error message indicating the binding failure and exit with a non-zero status code
5. IF a POST request to `/sponsorship/request` contains an invalid or missing `walletAddress`, THEN THE Runtime_Validator SHALL confirm that the server responds with HTTP 400 and a JSON body containing an `error` field describing the validation failure

### Requirement 3: Worker Startup Validation

**User Story:** As a platform operator, I want to verify that the worker process initializes all subsystems, so that I can confirm the relay pipeline is ready.

#### Acceptance Criteria

1. WHEN the Worker_Process starts, THE Runtime_Validator SHALL confirm that `loadConfig()` completes without calling `process.exit(1)` and that all required environment variables (DATABASE_URL, CHAIN_RPC_URL, SPONSOR_PRIVATE_KEY, CHAIN_ID, CONTRACT_ADDRESS_SPONSOR_VAULT, CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY) are present and pass format validation
2. WHEN the Worker_Process starts, THE Runtime_Validator SHALL confirm that `createViemClients()` derives a 42-character hexadecimal account address from SPONSOR_PRIVATE_KEY via secp256k1 curve point validation
3. WHEN the Worker_Process starts, THE Runtime_Validator SHALL confirm that `verifyChainId()` receives chain ID 1942999 from the configured CHAIN_RPC_URL within the chain ID verification timeout (default 10000ms, configurable via CHAIN_ID_VERIFY_TIMEOUT_MS between 1000ms and 30000ms)
4. WHEN the Worker_Process starts, THE Runtime_Validator SHALL confirm that `initializeContractClient()`, `initializeRelayExecutor()`, and `createPoller()` each complete without throwing, and that `poller.start()` begins polling
5. IF any subsystem in the startup sequence (loadConfig, createViemClients, verifyChainId, initializeContractClient, initializeRelayExecutor, createPoller) throws an error, THEN THE Runtime_Validator SHALL log the failing subsystem name and error message, and the Worker_Process SHALL exit with code 1
6. IF `verifyChainId()` does not receive a response from the RPC endpoint within the configured timeout, THEN THE Runtime_Validator SHALL log a timeout error indicating the RPC endpoint may be unreachable, and the Worker_Process SHALL exit with code 1

### Requirement 4: Contract Client Initialization Validation

**User Story:** As a platform operator, I want to verify that the contract client connects to deployed Arc testnet contracts, so that I can confirm on-chain interaction is possible.

#### Acceptance Criteria

1. WHEN `initializeContractClient()` is called, THE Runtime_Validator SHALL call eth_getCode for the SponsorVault contract address on Arc_Testnet and confirm the returned bytecode is a hex string longer than 2 characters (i.e., not "0x") within 10000 milliseconds
2. WHEN `initializeContractClient()` is called, THE Runtime_Validator SHALL call eth_getCode for the SponsorshipRegistry contract address on Arc_Testnet and confirm the returned bytecode is a hex string longer than 2 characters (i.e., not "0x") within 10000 milliseconds
3. WHEN the Contract_Client is initialized, THE Runtime_Validator SHALL confirm that the explorer base URL is a valid HTTP or HTTPS URL ending with a trailing slash character
4. IF a contract address returns no deployed bytecode (response is "0x" or empty), THEN THE Runtime_Validator SHALL log an error message indicating which contract address has no bytecode and exit with a non-zero status code
5. IF the eth_getCode RPC call does not respond within 10000 milliseconds, THEN THE Runtime_Validator SHALL log an error message indicating a bytecode verification timeout and exit with a non-zero status code

### Requirement 5: Poller Loop Validation

**User Story:** As a platform operator, I want to verify that the worker poller loop executes cleanly, so that I can confirm request processing is active.

#### Acceptance Criteria

1. WHEN the Poller starts, THE Runtime_Validator SHALL confirm that the first poll cycle completes without throwing an unhandled exception and that the poll query returns a result set (empty or non-empty) within 10 seconds
2. WHEN the Poller queries for pending requests, THE Runtime_Validator SHALL confirm that the SQL query executes against the `sponsorship_requests` table and the `relay_transactions` table without error, selecting requests with status 'pending' or status 'relayed' with no active relay transaction, limited to the configured batchSize (1 to 100, default 20)
3. WHILE the Poller is running, THE Runtime_Validator SHALL confirm that subsequent poll cycles are scheduled using setTimeout at the configured POLL_INTERVAL_MS interval (1000 to 60000 milliseconds, default 5000) and that a new cycle does not begin until the previous cycle has completed
4. IF the Poller encounters a database connection error during a poll cycle, THEN THE Runtime_Validator SHALL confirm that the error is logged with the error message, that the poller does not crash, and that the next poll cycle is scheduled normally
5. IF a single request fails processing within a batch, THEN THE Runtime_Validator SHALL confirm that the Poller logs the failure with the request ID and error details and continues processing the remaining requests in the batch

### Requirement 6: Sponsorship Request Lifecycle Validation

**User Story:** As a platform operator, I want to verify that a sponsorship request transitions through all expected states, so that I can confirm the end-to-end flow works.

#### Acceptance Criteria

1. WHEN a POST to `/sponsorship/request` is made with a valid wallet address (0x-prefixed, 40 hexadecimal characters, checksummed), THE Runtime_Validator SHALL confirm that the response contains a UUID `id` field and status `pending` within 5 seconds of the request being sent
2. WHEN the Runtime_Validator polls GET `/sponsorship/:id` at 2-second intervals after request creation, THE Runtime_Validator SHALL confirm that the request status transitions from `pending` through `approved` to `relayed` within 30 seconds
3. WHEN the request status reaches `relayed`, THE Runtime_Validator SHALL confirm that the status transitions to `completed` and the response includes a non-empty `transactionHash` field within 120 seconds of the original request
4. WHEN the request reaches `completed` status, THE Runtime_Validator SHALL confirm that a RelayTransaction record exists with status `confirmed`, a non-empty `transactionHash`, and a non-null `confirmedAt` timestamp
5. IF the sponsorship request status transitions to `failed` or the polling timeout of 120 seconds elapses without reaching `completed`, THEN THE Runtime_Validator SHALL report the `failureReason` field from the response and exit with a non-zero status code
6. WHEN polling for status transitions, THE Runtime_Validator SHALL treat the `approved` state as a valid intermediate state that occurs between `pending` and `relayed`, without requiring it to persist for any minimum duration

### Requirement 7: Transaction Hash Persistence Validation

**User Story:** As a platform operator, I want to verify that transaction hashes are persisted correctly, so that I can confirm on-chain activity is recorded.

#### Acceptance Criteria

1. WHEN a relay transaction is confirmed on-chain with a transaction hash present, THE Runtime_Validator SHALL confirm that the `transactionHash` field on the RelayTransaction record is a valid 66-character hex string (0x prefix followed by exactly 64 hexadecimal characters, case-insensitive)
2. WHEN a relay transaction is confirmed on-chain with a transaction hash present, THE Runtime_Validator SHALL confirm that the `transactionHash` field is unique across all RelayTransaction records in the database
3. WHEN a relay transaction is confirmed on-chain with block data available, THE Runtime_Validator SHALL confirm that the `blockNumber` field is populated with a positive integer greater than or equal to 1
4. WHEN a relay transaction is confirmed on-chain, THE Runtime_Validator SHALL confirm that the `confirmedAt` timestamp is set to a value that is equal to or later than the record's `submittedAt` timestamp and no later than 60 seconds after the current system time
5. IF a relay transaction is confirmed via the AlreadySponsored path where the relay executor does not return a transaction hash, THEN THE Runtime_Validator SHALL confirm that the RelayTransaction record's `transactionHash` field remains null and the record's status is still set to confirmed
6. IF the `updateRelayTransaction` call fails during persistence of confirmation data, THEN THE Runtime_Validator SHALL confirm that the RelayTransaction record retains its pre-confirmation state and an error is propagated to the caller

### Requirement 8: Explorer URL Generation Validation

**User Story:** As a platform operator, I want to verify that explorer URLs are generated and stored correctly, so that I can confirm users receive valid block explorer links.

#### Acceptance Criteria

1. WHEN a relay transaction is confirmed, THE Runtime_Validator SHALL confirm that the `explorerUrl` field follows the pattern `https://testnet.arcscan.io/tx/{transactionHash}` where `{transactionHash}` is a 66-character string starting with `0x` followed by 64 lowercase hexadecimal characters
2. WHEN a relay transaction is confirmed, THE Runtime_Validator SHALL confirm that the `explorerUrl` contains the exact transaction hash stored in the `transactionHash` field of the same `RelayTransaction` record
3. WHEN a relay transaction is confirmed, THE Runtime_Validator SHALL confirm that the `explorerUrl` length does not exceed 512 characters
4. IF the `explorerUrl` field is null after a relay transaction reaches `confirmed` status, THEN THE Runtime_Validator SHALL flag a validation failure identifying the associated relay transaction ID and the missing URL field
5. WHEN a relay transaction is confirmed, THE Runtime_Validator SHALL confirm that the `explorerUrl` is composed of exactly the configured base URL concatenated with the transaction hash, with no additional path segments, query parameters, or fragment identifiers

### Requirement 9: On-Chain Receipt Confirmation Validation

**User Story:** As a platform operator, I want to verify that on-chain transaction receipts confirm success, so that I can confirm funds were transferred.

#### Acceptance Criteria

1. WHEN a transaction hash is obtained from a completed sponsorship, THE Runtime_Validator SHALL issue an `eth_getTransactionReceipt` JSON-RPC call to Arc_Testnet and confirm that the response contains a non-null receipt within 30 seconds
2. WHEN the receipt is retrieved, THE Runtime_Validator SHALL confirm that the receipt status field equals `0x1` (success)
3. WHEN the receipt is retrieved, THE Runtime_Validator SHALL confirm that the receipt `blockNumber` is a non-null hex string matching the pattern `0x` followed by 1 or more hexadecimal digits, representing a positive integer
4. WHEN the receipt is retrieved, THE Runtime_Validator SHALL confirm that the receipt `logs` array contains at least one log entry with a topic matching the SponsorshipGranted event signature
5. IF the RPC call returns an HTTP error or a JSON-RPC error response, THEN THE Runtime_Validator SHALL report the transaction hash and the error details and exit with a non-zero status code
6. IF the receipt is null (transaction not yet mined), THEN THE Runtime_Validator SHALL retry the `eth_getTransactionReceipt` call at 2-second intervals for a maximum of 30 seconds before reporting the transaction hash as unconfirmed
7. IF the receipt status is not `0x1`, THEN THE Runtime_Validator SHALL report the transaction hash and receipt status and exit with a non-zero status code

### Requirement 10: End-to-End Validation Script Execution

**User Story:** As a platform operator, I want to run the existing validate-e2e.ts script against the live runtime, so that I can confirm the full sponsorship pipeline works end-to-end.

#### Acceptance Criteria

1. WHEN `npx tsx scripts/validate-e2e.ts` is executed with environment variables API_BASE_URL, CHAIN_RPC_URL, and VALIDATION_WALLET_ADDRESS set to non-empty values, THE Validate_E2E_Script SHALL exit with status code 0 within 180 seconds
2. WHEN the Validate_E2E_Script completes successfully, THE Runtime_Validator SHALL confirm that the output contains a transaction hash matching the pattern `0x` followed by exactly 64 hexadecimal characters, an explorer URL starting with `http://` or `https://`, and a block number that is a positive integer
3. WHEN the Validate_E2E_Script completes successfully, THE Runtime_Validator SHALL confirm that the explorer URL in the output contains the transaction hash from the output as a substring
4. IF the Validate_E2E_Script exits with a non-zero status code, THEN THE Runtime_Validator SHALL fail the validation run and include the captured stderr output in its report
5. IF any of the required environment variables (API_BASE_URL, CHAIN_RPC_URL, VALIDATION_WALLET_ADDRESS) is missing or empty, THEN THE Validate_E2E_Script SHALL exit with a non-zero status code and write an error message to stderr indicating which variable is missing

### Requirement 11: Environment Configuration Validation

**User Story:** As a platform operator, I want to verify that all required environment variables are present and valid before running validation, so that I can distinguish configuration errors from runtime errors.

#### Acceptance Criteria

1. THE Runtime_Validator SHALL confirm that DATABASE_URL is set and follows the PostgreSQL connection string format (`postgresql://` prefix)
2. THE Runtime_Validator SHALL confirm that CHAIN_RPC_URL is set and begins with `http://` or `https://`
3. THE Runtime_Validator SHALL confirm that CHAIN_ID is set to a positive integer value of `1942999`
4. THE Runtime_Validator SHALL confirm that CONTRACT_ADDRESS_SPONSOR_VAULT is set and matches the pattern `^0x[0-9a-fA-F]{40}$`
5. THE Runtime_Validator SHALL confirm that CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY is set and matches the pattern `^0x[0-9a-fA-F]{40}$`
6. THE Runtime_Validator SHALL confirm that SPONSOR_PRIVATE_KEY is set and, after stripping an optional `0x` prefix, is a valid 64-character hexadecimal string matching `^[0-9a-fA-F]{64}$`
7. IF any required environment variable is missing or malformed, THEN THE Runtime_Validator SHALL report all invalid variables in a single error message to stderr and exit with a non-zero status code
8. THE Runtime_Validator SHALL validate optional numeric environment variables (POLL_INTERVAL_MS, BATCH_SIZE, MAX_RETRIES, LOCK_TIMEOUT_MS, SHUTDOWN_TIMEOUT_MS, CONFIRMATION_BLOCKS, TX_TIMEOUT_MS, CHAIN_ID_VERIFY_TIMEOUT_MS) against their configured ranges when explicitly set, and report any out-of-range values in the same error message
