# Requirements Document

## Introduction

This specification covers the end-to-end sponsored transaction execution for ArcPass on the Arc testnet. The existing worker runtime, Prisma models, relay lifecycle, and contract client are already implemented. This spec focuses on the remaining gaps needed to execute real sponsored transactions against the deployed SponsorVault and SponsorshipRegistry contracts: explorer URL generation and persistence, environment configuration for Arc testnet deployment, nonce management for deterministic retry-safe execution, handling of real network conditions (reorgs, RPC failures, gas estimation), and integration validation of the complete flow.

## Glossary

- **Worker**: The background process (`apps/worker`) that polls for pending sponsorship requests and executes relay transactions sequentially
- **Relay_Executor**: The module that resolves wallet addresses and delegates contract calls to the Contract_Client
- **Contract_Client**: The module that calls `SponsorVault.sponsorTransfer` on-chain, waits for receipt, and decodes events/errors
- **Processor**: The orchestrator module that manages the full lifecycle within a single database transaction using SELECT FOR UPDATE SKIP LOCKED
- **SponsorVault**: The deployed smart contract that executes native token transfers to recipient wallets
- **SponsorshipRegistry**: The deployed smart contract that records sponsorship grants and emits `SponsorshipGranted` events
- **Explorer_URL**: A fully-qualified HTTPS URL pointing to the transaction on the Arc testnet block explorer
- **Relay_Transaction**: The database record tracking a single on-chain relay attempt including hash, status, block number, and event data
- **Sponsorship_Request**: The database record representing a wallet's request for sponsored onboarding
- **Nonce_Manager**: Logic ensuring that each relay execution uses a deterministic nonce to prevent duplicate on-chain transactions during retries
- **Arc_Testnet**: The target EVM-compatible blockchain network (chain ID 1942999) where contracts are deployed

## Requirements

### Requirement 1: Explorer URL Generation and Storage

**User Story:** As an operator, I want each confirmed relay transaction to include a block explorer URL, so that I can verify the transaction on-chain and share proof of sponsorship.

#### Acceptance Criteria

1. WHEN a relay transaction is confirmed on-chain (receipt status is `success`), THE Contract_Client SHALL generate an Explorer_URL by concatenating the configured explorer base URL with the transaction hash
2. THE Processor SHALL persist the Explorer_URL in the Relay_Transaction record alongside the transaction hash and block number when updating the relay status to `confirmed`
3. WHEN the `EXPLORER_BASE_URL` environment variable is not set or is an empty string, THE Worker SHALL generate Explorer_URL using the default Arc testnet explorer base URL `https://testnet.arcscan.io/tx/`
4. THE Explorer_URL SHALL follow the format `{EXPLORER_BASE_URL}{transactionHash}` where transactionHash is the full 66-character hex string including `0x` prefix, and the base URL SHALL be normalized to include a trailing slash if one is not present
5. WHEN a relay transaction fails or reverts on-chain, THE Worker SHALL NOT generate or store an Explorer_URL for that transaction

### Requirement 2: Deterministic Retry-Safe Execution

**User Story:** As an operator, I want relay execution to be safe against retries, so that a wallet cannot receive duplicate sponsored transactions if the worker restarts or retries a request.

#### Acceptance Criteria

1. WHEN the Worker retries a previously attempted sponsorship request, THE Processor SHALL query for existing Relay_Transaction records with status "submitted" or "confirmed" for that Sponsorship_Request before initiating a new relay, and SHALL skip relay execution if any such record exists
2. IF a Relay_Transaction with status "confirmed" already exists for a sponsorship request, THEN THE Processor SHALL skip relay execution, preserve the existing Relay_Transaction record unchanged, and transition the Sponsorship_Request to "completed" status
3. IF the Sponsorship_Request status is not "pending" when the Processor acquires the row lock, THEN THE Processor SHALL skip processing and leave the request in its current status without creating a new Relay_Transaction
4. THE Processor SHALL use SELECT FOR UPDATE SKIP LOCKED when acquiring a Sponsorship_Request row, so that concurrent workers processing the same request observe zero rows returned and skip processing rather than blocking
5. WHEN a relay attempt fails with an `AlreadySponsored` contract error, THE Processor SHALL update the Relay_Transaction to "confirmed" status and transition the Sponsorship_Request to "completed" status, since the wallet has already received sponsorship on-chain
6. IF the number of failed Relay_Transaction records for a Sponsorship_Request equals or exceeds the configured maximum retry limit (1 to 10 attempts, default 5), THEN THE Processor SHALL transition the Sponsorship_Request to "failed" status without initiating a new relay

### Requirement 3: Real Network Error Handling

**User Story:** As an operator, I want the worker to handle real network conditions gracefully, so that transient failures do not permanently block sponsorship processing.

#### Acceptance Criteria

1. WHEN the RPC endpoint returns a connection timeout or connection refused error, THE Contract_Client SHALL return a failure result with `success: false`, a `failureReason` containing the transport error description, a `transactionHash` of null, and the corresponding Relay_Transaction SHALL be marked as failed with the failure reason preserved in the `failureReason` column
2. WHEN the RPC endpoint returns a nonce-too-low error, THE Contract_Client SHALL return a failure result with `success: false` and a `failureReason` that includes the string "nonce" so the Processor can identify nonce conflicts when determining if the transaction was already mined
3. WHEN `waitForTransactionReceipt` exceeds the configured TX_TIMEOUT_MS (range: 10000–600000ms, default: 120000ms), THE Contract_Client SHALL return a failure result with `failureReason` containing "Transaction confirmation timeout" and SHALL preserve the `transactionHash` value obtained from the prior `writeContract` call
4. WHEN gas estimation fails before transaction submission, THE Contract_Client SHALL return a failure result with `success: false`, a `failureReason` containing the gas estimation error description, and a `transactionHash` of null
5. IF the RPC endpoint returns an HTTP 429 (rate limited) response, THEN THE Contract_Client SHALL return a failure result with `success: false` and a `failureReason` containing "rate limited", allowing the Processor to mark the Relay_Transaction as failed and re-attempt on the next poll cycle
6. WHEN a transaction reverts on-chain, THE Contract_Client SHALL attempt to decode the custom error using `decodeErrorResult` with the SponsorVault ABI and store the decoded error name and arguments in the `failureReason` field of the Relay_Transaction
7. IF decoding a custom revert error fails (the error data does not match any selector in the SponsorVault ABI), THEN THE Contract_Client SHALL fall back to storing a generic failure reason indicating the transaction reverted without decoded details
8. THE Contract_Client SHALL truncate any `failureReason` string to a maximum of 1000 characters before returning the result, matching the database column constraint

### Requirement 4: Arc Testnet Environment Configuration

**User Story:** As a developer, I want all Arc testnet connection parameters to be configurable via environment variables, so that the worker can be deployed against the live testnet without code changes.

#### Acceptance Criteria

1. THE Worker SHALL require the environment variable `CHAIN_RPC_URL` containing a URL with an `http://` or `https://` scheme pointing to the Arc testnet RPC endpoint
2. THE Worker SHALL require the environment variable `CHAIN_ID` set to the Arc testnet chain ID (1942999), validated as a positive integer
3. THE Worker SHALL require the environment variable `SPONSOR_PRIVATE_KEY` containing a 64-character hexadecimal string (with or without `0x` prefix) representing the operator wallet private key
4. THE Worker SHALL require the environment variables `CONTRACT_ADDRESS_SPONSOR_VAULT` and `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY` each containing a 42-character hex address (`0x` followed by 40 hexadecimal characters, case-insensitive)
5. THE Worker SHALL accept an optional environment variable `EXPLORER_BASE_URL` defaulting to `https://testnet.arcscan.io/tx/`
6. IF any required environment variable is missing or fails its format validation at startup, THEN THE Worker SHALL log a single error message listing all invalid variable names and terminate with a non-zero exit code
7. THE Worker SHALL accept an optional environment variable `CHAIN_ID_VERIFY_TIMEOUT_MS` (integer, range 1000–30000, default 10000) controlling the maximum time allowed for RPC chain ID verification at startup
8. WHEN the Worker starts, THE Worker SHALL query the RPC endpoint for its chain ID within the configured `CHAIN_ID_VERIFY_TIMEOUT_MS` and terminate with a non-zero exit code if the returned chain ID does not match `CHAIN_ID`, the RPC does not respond within the timeout, or the RPC connection fails

### Requirement 5: Transaction Lifecycle Persistence

**User Story:** As an operator, I want the full transaction lifecycle persisted in the database, so that I can audit every relay attempt and its outcome.

#### Acceptance Criteria

1. WHEN a relay transaction is submitted to the network, THE Processor SHALL persist the transaction hash in the Relay_Transaction record with status `submitted` and a `submittedAt` timestamp set to the current UTC time
2. WHEN a relay transaction is confirmed on-chain, THE Processor SHALL update the Relay_Transaction record with status `confirmed`, `confirmedAt` timestamp, block number, event name (`SponsorshipGranted`), decoded event data (recipient, amount, timestamp as JSON), and Explorer_URL
3. WHEN a relay transaction fails, THE Processor SHALL update the Relay_Transaction record with status `failed`, `failedAt` timestamp, and a failure reason truncated to a maximum of 1000 characters
4. THE Processor SHALL execute all status transitions and Relay_Transaction updates within a single database transaction to maintain atomicity — if any step fails, all changes within that transaction SHALL be rolled back
5. WHEN the Sponsorship_Request transitions to `completed`, THE Processor SHALL increment the associated Wallet record's `sponsorshipCount` by 1 within the same database transaction
6. FOR ALL Relay_Transaction records, the status transitions SHALL follow the valid transition map: queued→submitted, queued→failed, submitted→confirmed, submitted→failed — any other transition SHALL be rejected by the lifecycle module

### Requirement 6: Structured Logging for Relay Stages

**User Story:** As an operator, I want structured JSON logs emitted at every relay stage, so that I can observe the full lifecycle from API logs and diagnose issues.

#### Acceptance Criteria

1. WHEN the Processor begins processing a Sponsorship_Request, THE Worker SHALL emit a structured log entry with level `info`, the component name of the emitting module, sponsorship request ID, wallet address, and current relay attempt number (starting at 1 for the first attempt)
2. WHEN the Contract_Client broadcasts a transaction, THE Worker SHALL emit a structured log entry with level `info`, the transaction hash, recipient address, and sponsorship amount in base units
3. WHEN the Contract_Client receives a transaction receipt, THE Worker SHALL emit a structured log entry with the outcome (`confirmed` or `reverted`), transaction hash, block number, and elapsed time in milliseconds measured from the start of the relay execution for that attempt
4. WHEN a status transition occurs, THE Worker SHALL emit a structured log entry with level `info`, the previous status, new status, and sponsorship request ID
5. WHEN an error occurs at any relay stage, THE Worker SHALL emit a structured log entry with level `error`, the error message (truncated to 1000 characters maximum), sponsorship request ID, the relay stage where the error occurred, and elapsed time in milliseconds measured from the start of the relay execution for that attempt
6. THE Worker SHALL NOT include private keys, mnemonic phrases, credential-bearing URLs (URLs containing user:password segments), or field values whose keys match sensitive patterns (secret, password, credential, authorization) in any log entry
7. THE Worker SHALL emit each structured log entry as a single-line JSON object to stdout for `info` and `warn` levels, and to stderr for `error` level, containing at minimum the fields: timestamp (ISO 8601), level, component, and message

### Requirement 7: Wallet Sponsorship Count Synchronization

**User Story:** As an operator, I want the database wallet sponsorship count to stay synchronized with on-chain state, so that eligibility checks remain accurate.

#### Acceptance Criteria

1. WHEN a Sponsorship_Request transitions to `completed`, THE Processor SHALL increment the Wallet `sponsorshipCount` field by 1 within the same database transaction that updates the Sponsorship_Request status
2. WHEN a relay fails with `AlreadySponsored` and the Processor treats the Sponsorship_Request as completed, THE Processor SHALL increment the Wallet `sponsorshipCount` by 1 within the same database transaction to reflect the on-chain reality
3. IF a Sponsorship_Request transitions to `failed` or `rejected`, THEN THE Processor SHALL NOT increment the Wallet `sponsorshipCount` field
4. WHEN the Processor acquires a lock on a pending Sponsorship_Request and the associated Wallet `isBlocked` field is true, THE Processor SHALL transition the Sponsorship_Request to `rejected` status with an eligibilityReason indicating the wallet is blocked
5. IF the database transaction containing the `sponsorshipCount` increment fails to commit, THEN THE Processor SHALL roll back both the status transition and the increment, leaving the Sponsorship_Request in its previous status

### Requirement 8: End-to-End Integration Validation

**User Story:** As a developer, I want a validation script that exercises the full flow against Arc testnet, so that I can demonstrate the system works end-to-end for the Circle grant demo.

#### Acceptance Criteria

1. THE Validation_Script SHALL create a Sponsorship_Request via the API endpoint `POST /sponsorship/request` with a valid wallet address (0x-prefixed, 40 hexadecimal characters, lowercase-normalized) and verify the response returns HTTP 201 with a JSON body containing a sponsorship request `id` in UUID format and `status` of `pending`
2. THE Validation_Script SHALL poll the `GET /sponsorship/:id` endpoint at an interval of 2 seconds until the request reaches `completed` or `failed` status, with a configurable timeout defaulting to 120 seconds
3. WHEN the Sponsorship_Request reaches `completed` status, THE Validation_Script SHALL verify that the response includes a Relay_Transaction with a `transactionHash` matching the pattern `0x[0-9a-f]{64}` and a constructed Explorer_URL containing the transaction hash appended to the Arc testnet block explorer base URL
4. THE Validation_Script SHALL verify the transaction hash exists on-chain by querying the Arc testnet RPC endpoint using `eth_getTransactionReceipt` and confirming the receipt contains a non-null `blockNumber` and a `status` of `1` (success)
5. THE Validation_Script SHALL output a summary including: wallet address, sponsorship request ID, transaction hash, Explorer_URL, block number, and total elapsed time in seconds from request creation to completion confirmation
6. IF the Sponsorship_Request reaches `failed` status, THEN THE Validation_Script SHALL output the `failureReason` field from the Relay_Transaction record to stderr and exit with a non-zero exit code
7. IF the polling timeout elapses before the Sponsorship_Request reaches a terminal status (`completed` or `failed`), THEN THE Validation_Script SHALL output an error message indicating the timeout duration and the last observed status, and exit with a non-zero exit code
8. IF the `POST /sponsorship/request` endpoint returns a non-201 HTTP status, THEN THE Validation_Script SHALL output the HTTP status code and error response body to stderr and exit with a non-zero exit code

### Requirement 9: Graceful Shutdown During Active Relay

**User Story:** As an operator, I want the worker to shut down gracefully even during an active relay, so that in-progress transactions are not left in an inconsistent state.

#### Acceptance Criteria

1. WHEN a shutdown signal (SIGTERM or SIGINT) is received during an active relay execution, THE Worker SHALL set the `isRunning` flag to false and allow the current relay processing to complete before stopping the poller
2. WHEN the shutdown timeout (configurable via `SHUTDOWN_TIMEOUT_MS`, range 5000–60000ms, default 10000ms) is exceeded while waiting for an active relay, THE Worker SHALL force-stop with a non-zero exit code and the in-progress Sponsorship_Request SHALL remain in `relayed` status for recovery on next startup
3. WHEN the Worker starts and the Poller queries for pending requests, THE Poller SHALL also include Sponsorship_Requests in `relayed` status that have no Relay_Transaction with status "submitted" or "confirmed", so that stale relayed requests are re-attempted on the next poll cycle
4. THE Worker SHALL disconnect the Prisma client only after the poller has fully stopped (either by completing in-progress work or by shutdown timeout expiring)
