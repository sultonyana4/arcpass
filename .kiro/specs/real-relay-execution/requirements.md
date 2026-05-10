# Requirements Document

## Introduction

Replace the mock relay simulator in the ArcPass worker with a production-ready blockchain relay execution layer. This feature enables real EVM transaction broadcasting for sponsorship processing on Arc Network using the viem library. The relay executor integrates into the existing worker polling architecture, reuses PostgreSQL + Prisma models, and maintains the established sponsorship lifecycle state machine. No frontend, queue infrastructure, or external SaaS dependencies are introduced.

## Glossary

- **Relay_Executor**: The service module responsible for constructing, signing, broadcasting, and confirming real EVM transactions on-chain via viem
- **Worker**: The existing background polling process (`apps/worker`) that discovers pending sponsorship requests and dispatches them for processing
- **Processor**: The orchestration module within the Worker that drives a sponsorship request through its lifecycle states within a database transaction
- **Sponsor_Wallet**: The server-side EVM wallet whose private key is loaded from environment variables and used to sign relay transactions
- **Viem_Client**: A viem public client and wallet client instance configured with a chain RPC URL for transaction broadcasting and receipt polling
- **Transaction_Receipt**: The on-chain confirmation object returned by the RPC node after a transaction is mined, containing status, block number, and gas used
- **Confirmation_Depth**: The number of additional blocks mined after the block containing the transaction, used to determine finality
- **Row_Lock**: A PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` advisory lock on a sponsorship request row to prevent concurrent processing
- **Relay_Transaction**: The existing Prisma model that records each relay attempt, its status, transaction hash, and timestamps
- **Sponsorship_Request**: The existing Prisma model representing a wallet's sponsorship lifecycle from pending through completion or failure
- **RPC_URL**: The HTTP(S) endpoint for the target EVM chain node used by the Viem_Client for all blockchain interactions

## Requirements

### Requirement 1: Relay Executor Service

**User Story:** As a system operator, I want a real blockchain relay executor service, so that sponsorship transactions are broadcast to the actual EVM chain instead of being simulated.

#### Acceptance Criteria

1. WHEN the Processor invokes the Relay_Executor with a sponsorship request ID, THE Relay_Executor SHALL resolve the target wallet address from the sponsorship request record, construct an EVM transaction sending the configured sponsorship amount of native token to that wallet address, and return a RelayResult with `success: true` and the `transactionHash` field set to the on-chain transaction hash (66-character hex string prefixed with `0x`)
2. THE Relay_Executor SHALL sign the constructed transaction using the Sponsor_Wallet private key loaded from the `SPONSOR_PRIVATE_KEY` environment variable
3. IF the `SPONSOR_PRIVATE_KEY` environment variable is missing or contains an invalid private key at service initialization, THEN THE Relay_Executor SHALL throw an error indicating the configuration is invalid, preventing the worker from starting
4. WHEN a signed transaction is ready, THE Relay_Executor SHALL broadcast the transaction to the configured chain via the Viem_Client using the RPC endpoint specified in the `CHAIN_RPC_URL` environment variable and return the transaction hash within the RelayResult structure
5. IF the Relay_Executor receives an RPC error during broadcast, THEN THE Relay_Executor SHALL return a RelayResult with `success: false`, `transactionHash: null`, and `failureReason` set to a string containing the error message, without throwing an unhandled exception
6. THE Relay_Executor SHALL expose a module-level async function matching the existing `simulateRelay` signature of `(sponsorshipRequestId: string, failureRate?: number) => Promise<RelayResult>` so the Processor can swap implementations without structural changes, where the `failureRate` parameter is accepted but ignored

### Requirement 2: Viem Client Configuration

**User Story:** As a system operator, I want configurable blockchain client settings, so that the relay executor can target different EVM chains and RPC providers.

#### Acceptance Criteria

1. THE Worker SHALL load the `CHAIN_RPC_URL` environment variable at startup, validate that it is a well-formed HTTP or HTTPS URL, and pass it to the Viem_Client factory
2. IF the `CHAIN_RPC_URL` environment variable is missing, empty, or not a valid HTTP/HTTPS URL, THEN THE Worker SHALL terminate with exit code 1 and a message identifying the variable and the validation failure
3. THE Worker SHALL load the `CONFIRMATION_BLOCKS` environment variable as an integer specifying the required Confirmation_Depth, defaulting to 2 when the variable is not set
4. THE Worker SHALL load the `TX_TIMEOUT_MS` environment variable as an integer specifying the maximum time to wait for transaction confirmation, defaulting to 120000 milliseconds when the variable is not set
5. IF `CONFIRMATION_BLOCKS` is not a valid integer or is outside the range 1 to 50 inclusive, THEN THE Worker SHALL terminate with exit code 1 and a message describing the constraint violation
6. IF `TX_TIMEOUT_MS` is not a valid integer or is outside the range 10000 to 600000 inclusive, THEN THE Worker SHALL terminate with exit code 1 and a message describing the constraint violation

### Requirement 3: Sponsor Wallet Management

**User Story:** As a system operator, I want the sponsor wallet private key securely loaded from environment configuration, so that the relay executor can sign transactions without hardcoded secrets.

#### Acceptance Criteria

1. THE Worker SHALL load the `SPONSOR_PRIVATE_KEY` environment variable at startup and derive the Sponsor_Wallet account using viem's `privateKeyToAccount` function
2. IF the `SPONSOR_PRIVATE_KEY` environment variable is missing or empty, THEN THE Worker SHALL terminate with a non-zero exit code and log an error message indicating the variable is required without exposing any key material
3. THE Worker SHALL validate that the `SPONSOR_PRIVATE_KEY` value is a valid 64-character hexadecimal string (with or without `0x` prefix) and that it represents a cryptographically valid secp256k1 private key by successfully deriving an account via `privateKeyToAccount`
4. IF the `SPONSOR_PRIVATE_KEY` value fails format validation or cryptographic derivation, THEN THE Worker SHALL terminate with a non-zero exit code and log an error message indicating the key is invalid without exposing the provided value
5. THE Worker SHALL log the derived Sponsor_Wallet public address at startup for operational verification without logging the private key
6. THE Worker SHALL complete all `SPONSOR_PRIVATE_KEY` validation and wallet derivation before beginning to poll for sponsorship requests, so that an invalid key causes immediate failure rather than failure on first relay attempt

### Requirement 4: Transaction Receipt Polling

**User Story:** As a system operator, I want the relay executor to poll for transaction confirmation, so that sponsorship lifecycle states accurately reflect on-chain finality.

#### Acceptance Criteria

1. WHEN the Relay_Executor successfully broadcasts a transaction, THE Relay_Executor SHALL invoke the Viem_Client `waitForTransactionReceipt` with the transaction hash, the configured Confirmation_Depth, and the configured `TX_TIMEOUT_MS` as the timeout parameter
2. WHEN the Transaction_Receipt indicates a successful transaction (status = 1) and the Confirmation_Depth has been reached, THE Relay_Executor SHALL return a success result containing the transaction hash and the block number at which the transaction was included
3. WHEN the Transaction_Receipt indicates a reverted transaction (status = 0), THE Relay_Executor SHALL return a failure result containing the transaction hash and a "transaction reverted" reason
4. IF polling exceeds the configured `TX_TIMEOUT_MS` duration without receiving a confirmed receipt, THEN THE Relay_Executor SHALL return a failure result with a "transaction timeout" reason and the pending transaction hash
5. IF an RPC error occurs during receipt polling, THEN THE Relay_Executor SHALL return a failure result containing the RPC error message and the pending transaction hash

### Requirement 5: Sponsorship Lifecycle Integration

**User Story:** As a system operator, I want the relay executor integrated into the existing sponsorship lifecycle, so that real transaction results drive state transitions and timestamp updates.

#### Acceptance Criteria

1. WHEN the Processor transitions a sponsorship request from approved to relayed, THE Processor SHALL invoke the Relay_Executor instead of the relay simulator
2. WHEN the Relay_Executor returns a success result containing a transaction hash, THE Processor SHALL persist the transaction hash (a 66-character hex string prefixed with "0x") and the `confirmedAt` timestamp into the Relay_Transaction record and transition the relay status to confirmed
3. WHEN the Relay_Executor returns a failure result containing a failure reason, THE Processor SHALL persist the failure reason (maximum 1000 characters) and the `failedAt` timestamp into the Relay_Transaction record and transition the relay status to failed
4. WHEN the relay status transitions to confirmed, THE Processor SHALL transition the Sponsorship_Request status to completed and set the `completedAt` timestamp
5. WHEN the relay status transitions to failed, THE Processor SHALL transition the Sponsorship_Request status to failed and set the `failedAt` timestamp
6. WHEN the Relay_Executor broadcasts the transaction to the network, THE Processor SHALL persist the `submittedAt` timestamp on the Relay_Transaction record before confirmation polling begins
7. IF the Relay_Executor throws an exception or returns an unrecognized result, THEN THE Processor SHALL persist the error message as the failure reason into the Relay_Transaction record, transition the relay status to failed, and transition the Sponsorship_Request status to failed
8. THE Processor SHALL execute all relay status transitions and Sponsorship_Request status transitions within a single Prisma database transaction to ensure atomicity

### Requirement 6: Duplicate Relay Prevention

**User Story:** As a system operator, I want duplicate relay execution prevented, so that a single sponsorship request is never broadcast to the chain more than once concurrently.

#### Acceptance Criteria

1. THE Processor SHALL acquire a PostgreSQL Row_Lock using `SELECT FOR UPDATE SKIP LOCKED` on the Sponsorship_Request row before invoking the Relay_Executor
2. IF the Row_Lock cannot be acquired (row already locked by another worker instance), THEN THE Processor SHALL skip the request without error and continue to the next request in the batch
3. THE Processor SHALL verify the Sponsorship_Request status is `pending` after acquiring the Row_Lock and before proceeding with relay execution
4. IF the Sponsorship_Request status is not `pending` after lock acquisition, THEN THE Processor SHALL release the lock by ending the transaction and skip processing without error
5. THE Relay_Transaction table's unique constraint on `transactionHash` SHALL prevent duplicate transaction hash persistence at the database level

### Requirement 7: Retry-Safe Processing

**User Story:** As a system operator, I want relay processing to be retry-safe, so that transient failures do not permanently block sponsorship requests and retries do not cause duplicate on-chain transactions.

#### Acceptance Criteria

1. WHEN the Relay_Executor returns a failure result (success=false), THE Processor SHALL transition the corresponding Relay_Transaction to `failed` with the returned failure reason and transition the Sponsorship_Request to `failed` status within the same database transaction
2. THE Processor SHALL enforce the configured `maxRetries` limit (default: 5, configurable via MAX_RETRIES environment variable, integer range 1–10) by counting existing Relay_Transaction records for the Sponsorship_Request before creating a new relay attempt
3. IF the Relay_Transaction count for a Sponsorship_Request equals or exceeds `maxRetries`, THEN THE Processor SHALL transition the Sponsorship_Request to `failed` without invoking the Relay_Executor
4. WHEN a database transaction fails (connection error, timeout, or lock contention), THE Processor SHALL leave the Sponsorship_Request in `pending` status so it can be retried on the next poll cycle without data modification
5. IF a Relay_Transaction with status `submitted` or `confirmed` already exists for the Sponsorship_Request, THEN THE Processor SHALL skip relay invocation to prevent duplicate on-chain transactions
6. THE Processor SHALL log each retry attempt as a structured log entry containing the Sponsorship_Request ID, current attempt number, and maximum allowed retries

### Requirement 8: Transaction Timeout Handling

**User Story:** As a system operator, I want transaction timeout handling, so that stuck transactions do not block the worker indefinitely.

#### Acceptance Criteria

1. THE Relay_Executor SHALL enforce the configured `TX_TIMEOUT_MS` (default: 120000ms, valid range: 10000–600000ms) as the maximum duration for the combined broadcast and receipt polling operation
2. IF the timeout is reached during receipt polling, THEN THE Relay_Executor SHALL abort polling and return a failure result with reason "transaction confirmation timeout"
3. WHEN a timeout failure occurs, THE Relay_Executor SHALL include the pending transaction hash in the failure result if a hash was obtained prior to timeout, or null if the broadcast did not return a hash before the timeout elapsed
4. WHEN the Processor receives a timeout failure from the Relay_Executor, THE Processor SHALL transition the Relay_Transaction record to "failed" status, persist the failure reason "transaction confirmation timeout", and store the transaction hash value (which may be null) in the transactionHash field
5. WHEN the Processor receives a timeout failure from the Relay_Executor, THE Processor SHALL transition the associated SponsorshipRequest status to "failed" and set the failedAt timestamp
6. THE Worker SHALL not block the poll cycle for longer than `TX_TIMEOUT_MS` plus the configured `lockTimeoutMs` (default: 30000ms) for any single sponsorship request

### Requirement 9: Graceful Failure Recovery

**User Story:** As a system operator, I want graceful failure recovery, so that individual relay failures do not crash the worker process or block other sponsorship requests.

#### Acceptance Criteria

1. IF the Relay_Executor throws an unexpected exception during relay processing, THEN THE Processor SHALL catch the exception, log the error including the request ID and exception message, and return a failure ProcessResult with `success: false` and the sponsorship request status unchanged from its pre-transaction state
2. IF a Prisma database error occurs during lifecycle transitions, THEN THE Processor SHALL roll back the entire database transaction so that the sponsorship request remains in its status prior to the failed transaction, and return a failure ProcessResult with `success: false`
3. WHEN the Worker receives a SIGTERM or SIGINT signal during relay execution, THE Worker SHALL stop accepting new poll cycles and wait for the current in-progress relay operation to complete for up to `shutdownTimeoutMs` (default: 30000 milliseconds) before disconnecting the database client
4. IF the shutdown timeout of `shutdownTimeoutMs` is exceeded while waiting for an in-progress relay operation, THEN THE Worker SHALL terminate the process with a non-zero exit code and log a warning message indicating the request ID of the in-progress relay that may require manual reconciliation
5. WHILE processing a batch of pending requests sequentially, THE Worker SHALL continue processing the next request in the batch after any single request returns a failure ProcessResult, until all batch items have been attempted or a shutdown signal is received

### Requirement 10: Structured Logging

**User Story:** As a system operator, I want structured logging for relay operations, so that I can monitor, debug, and audit transaction execution in production.

#### Acceptance Criteria

1. WHEN the Relay_Executor broadcasts a transaction, THE Relay_Executor SHALL log the sponsorship request ID, wallet address, and transaction hash at info level
2. WHEN the Relay_Executor confirms a transaction, THE Relay_Executor SHALL log the transaction hash, block number, and confirmation depth at info level
3. WHEN the Relay_Executor encounters a failure, THE Relay_Executor SHALL log the sponsorship request ID, failure reason, and any available transaction hash at error level
4. WHEN the Worker starts, THE Worker SHALL log the Sponsor_Wallet public address and chain RPC URL domain (hostname only, without path, query parameters, or credentials) at info level
5. WHEN the Processor transitions a Sponsorship_Request status, THE Processor SHALL log the sponsorship request ID, previous status, and new status at info level
6. THE Worker SHALL include a `component` field in every structured log entry with the originating module identifier (one of `relay-executor`, `processor`, or `worker`) to enable log filtering
7. THE Worker SHALL emit all log output as single-line JSON objects containing at minimum the fields: `timestamp` (ISO 8601), `level`, `component`, and `message`
8. THE Worker SHALL NOT include private keys, mnemonics, full RPC URLs containing credentials, or raw request bodies in any log output regardless of log level

### Requirement 11: Docker and Worker Compatibility

**User Story:** As a system operator, I want the relay executor to maintain compatibility with the existing Docker and worker infrastructure, so that deployment requires no infrastructure changes.

#### Acceptance Criteria

1. THE Worker SHALL maintain ESM-only module architecture where all source files use `import`/`export` syntax, package.json retains `"type": "module"`, and no `require()` calls are introduced
2. THE Worker SHALL build successfully through the existing Dockerfile multi-stage process (deps → build → runtime) without requiring modifications to the Dockerfile, and the resulting container image SHALL start without error
3. THE Worker SHALL produce compiled output at `dist/main.js` so that the existing `entrypoint.sh` script executes `prisma migrate deploy` followed by `node --import dotenv/config dist/main.js` without modification
4. THE Worker SHALL add viem as a pinned production dependency in the worker `package.json` such that `pnpm install --frozen-lockfile` succeeds and `pnpm deploy --filter=@arcpass/worker --prod` includes viem in the isolated deployment output
5. THE Worker SHALL maintain the existing poller-based architecture using `setTimeout` for scheduling (not `setInterval`), sequential per-request dispatch within each batch, and configurable `batchSize` limiting the number of requests per poll cycle
6. THE Worker SHALL maintain the existing graceful shutdown sequence where SIGTERM and SIGINT handlers set a shutdown flag, in-progress processing completes or a 10-second forced-exit timeout fires, and the process exits with code 0 on clean shutdown or code 1 on timeout or error
7. THE Worker SHALL NOT introduce dependencies requiring native compilation or additional Alpine system packages beyond those already installed in the Dockerfile runtime stage (node:22-alpine with openssl)

### Requirement 12: Configuration Completeness

**User Story:** As a system operator, I want all relay configuration documented and validated at startup, so that misconfiguration is caught immediately rather than at runtime during transaction processing.

#### Acceptance Criteria

1. THE Worker SHALL validate all required environment variables (`DATABASE_URL`, `SPONSOR_PRIVATE_KEY`, `CHAIN_RPC_URL`) at startup before beginning poll cycles
2. THE Worker SHALL validate all optional environment variables at startup, applying the following defaults when not provided: `POLL_INTERVAL_MS` (default: 5000, range: 1000–60000), `BATCH_SIZE` (default: 20, range: 1–100), `MAX_RETRIES` (default: 5, range: 1–10), `LOCK_TIMEOUT_MS` (default: 30000, range: 5000–120000), `SHUTDOWN_TIMEOUT_MS` (default: 10000, range: 5000–60000), `CONFIRMATION_BLOCKS` (default: 2, range: 1–50), `TX_TIMEOUT_MS` (default: 120000, range: 10000–600000)
3. IF any required environment variable is missing, THEN THE Worker SHALL terminate with exit code 1 and log a message identifying the missing variable name
4. IF any optional environment variable is present but contains a non-numeric value or a value outside its defined range, THEN THE Worker SHALL terminate with exit code 1 and log a message identifying the variable name, the invalid value, and the allowed range
5. IF `SPONSOR_PRIVATE_KEY` is present but is not a valid 64-character hexadecimal string (with or without `0x` prefix), THEN THE Worker SHALL terminate with exit code 1 and log a message indicating the format constraint
6. IF `CHAIN_RPC_URL` is present but is not a valid URL starting with `http://` or `https://`, THEN THE Worker SHALL terminate with exit code 1 and log a message indicating the format constraint
7. THE Worker SHALL NOT include the `RELAY_FAILURE_RATE` configuration parameter in its configuration schema
