# Requirements Document

## Introduction

The Sponsorship Worker is the asynchronous background execution pipeline for ArcPass sponsorship processing. It polls pending sponsorship requests from PostgreSQL, advances them through the sponsorship lifecycle (pending → approved → relayed → completed), simulates relay execution via a mock, creates relay transaction records, and ensures retry-safe, duplicate-free processing. This foundation enables future integration with real blockchain relay and external queue systems without architectural changes.

## Glossary

- **Worker**: The background service process (`apps/worker`) that runs independently of the API, polling for and processing sponsorship requests on a configurable interval
- **Sponsorship_Processor**: The core processing module that orchestrates the lifecycle advancement of a single sponsorship request from its current status to the next valid status
- **Relay_Simulator**: The mock module that simulates blockchain relay execution, producing a deterministic or randomized transaction hash without making real network calls
- **Processing_Lock**: A PostgreSQL-based mechanism that prevents concurrent processing of the same sponsorship request by multiple worker instances or poll cycles
- **Lifecycle_Manager**: The module responsible for validating and executing sponsorship status transitions, updating timestamps, and creating relay transaction records
- **Poll_Cycle**: A single iteration of the worker loop that queries for eligible sponsorship requests and dispatches them for processing
- **Sponsorship_Request**: A database record representing a wallet's request for gas sponsorship, with a status field tracking its position in the lifecycle
- **Relay_Transaction**: A database record representing a single attempt to relay a sponsored transaction on-chain, linked to a sponsorship request
- **Status_Transition**: A change in a sponsorship request's status field, constrained by the valid transition map defined in `@arcpass/shared`

## Requirements

### Requirement 1: Worker Polling

**User Story:** As a system operator, I want the worker to continuously poll for pending sponsorship requests, so that new requests are processed without manual intervention.

#### Acceptance Criteria

1. WHEN the Worker starts a Poll_Cycle, THE Worker SHALL query for Sponsorship_Requests with status "pending" ordered by `requestedAt` ascending
2. THE Worker SHALL limit each Poll_Cycle query to a configurable batch size with a default of 20 records and a permitted range of 1 to 100
3. WHEN no pending Sponsorship_Requests exist, THE Worker SHALL wait for the configured poll interval before starting the next Poll_Cycle
4. WHEN pending Sponsorship_Requests are found, THE Worker SHALL dispatch each request to the Sponsorship_Processor sequentially within the current Poll_Cycle
5. THE Worker SHALL use a configurable poll interval with a default of 5000 milliseconds and a permitted range of 1000 to 60000 milliseconds
6. IF the Sponsorship_Processor returns an error for a dispatched request, THEN THE Worker SHALL log the failure, skip the failed request, and continue processing the remaining requests in the current batch

### Requirement 2: Sponsorship Lifecycle Advancement

**User Story:** As a system operator, I want the worker to advance sponsorship requests through their full lifecycle, so that eligible wallets receive sponsored transactions.

#### Acceptance Criteria

1. WHEN the Sponsorship_Processor receives a Sponsorship_Request with status "pending", THE Sponsorship_Processor SHALL transition the status to "approved" and set the approvedAt timestamp to the current time
2. WHEN the Sponsorship_Processor has transitioned a Sponsorship_Request to "approved", THE Sponsorship_Processor SHALL create a Relay_Transaction with status "queued" and transition the Sponsorship_Request status to "relayed" within the same processing cycle, without waiting for external input
3. WHEN the Sponsorship_Processor has transitioned a Sponsorship_Request to "relayed", THE Sponsorship_Processor SHALL invoke the Relay_Simulator and transition the status to "completed" with the completedAt timestamp set when the Relay_Simulator returns a success result containing a transaction hash
4. IF the Relay_Simulator returns a failure result, THEN THE Sponsorship_Processor SHALL transition the Sponsorship_Request status to "failed", set the failedAt timestamp, and record the failure reason from the Relay_Simulator response on the associated Relay_Transaction
5. THE Lifecycle_Manager SHALL validate each Status_Transition against the VALID_SPONSORSHIP_TRANSITIONS map from `@arcpass/shared` before executing the update
6. IF the Lifecycle_Manager determines that a requested Status_Transition is not present in the VALID_SPONSORSHIP_TRANSITIONS map for the current status, THEN THE Lifecycle_Manager SHALL reject the transition and preserve the Sponsorship_Request in its current status without modification
7. IF the Sponsorship_Processor attempts to process a Sponsorship_Request that does not exist in the database, THEN THE Sponsorship_Processor SHALL skip processing for that request and not transition any status

### Requirement 3: Relay Execution Simulation

**User Story:** As a developer, I want a mock relay simulator, so that the worker pipeline can be tested end-to-end without real blockchain calls.

#### Acceptance Criteria

1. WHEN the Relay_Simulator is invoked with a sponsorship request ID, THE Relay_Simulator SHALL return a result object containing a `success` boolean, a `transactionHash` string (present on success, null on failure), and a `failureReason` string (present on failure, null on success)
2. IF the simulation result is successful, THEN THE Relay_Simulator SHALL generate a mock transaction hash in the format `0x` followed by 64 lowercase hexadecimal characters, where the first 8 hexadecimal characters are derived from the sponsorship request ID for traceability and the remaining 56 characters are randomly generated
3. THE Relay_Simulator SHALL complete execution within 100 milliseconds per invocation
4. IF the Relay_Simulator is configured with a failure rate between 0.0 and 1.0 inclusive, THEN THE Relay_Simulator SHALL return a failure result at the configured probability, with a `failureReason` string indicating the simulated failure cause (minimum 1 character, maximum 500 characters)
5. IF the Relay_Simulator is not configured with a failure rate, THEN THE Relay_Simulator SHALL default to a failure rate of 0.0 and return a successful result for every invocation
6. IF the Relay_Simulator receives an empty or undefined sponsorship request ID, THEN THE Relay_Simulator SHALL throw an error indicating that a valid sponsorship request ID is required

### Requirement 4: Relay Transaction Record Creation

**User Story:** As a system operator, I want relay transaction records created for each relay attempt, so that the system maintains a complete audit trail.

#### Acceptance Criteria

1. WHEN the Sponsorship_Processor transitions a Sponsorship_Request to "relayed", THE Lifecycle_Manager SHALL create a Relay_Transaction record with status "queued" and associate it with the originating Sponsorship_Request
2. WHEN a Relay_Transaction record is created, THE Lifecycle_Manager SHALL set the `relayAttempt` field to 1 if no prior Relay_Transaction exists for the associated Sponsorship_Request, or to the previous highest `relayAttempt` value plus 1 if prior attempts exist
3. WHEN the Relay_Simulator returns a successful result, THE Lifecycle_Manager SHALL update the Relay_Transaction status to "confirmed", store the transaction hash in the `transactionHash` field, and set the `confirmedAt` timestamp to the current time
4. WHEN the Relay_Simulator returns a failure result, THE Lifecycle_Manager SHALL update the Relay_Transaction status to "failed", store the failure reason in the `failureReason` field (maximum 1000 characters), and set the `failedAt` timestamp to the current time
5. WHEN the Lifecycle_Manager transitions a Relay_Transaction status to "submitted", THE Lifecycle_Manager SHALL set the `submittedAt` timestamp to the current time
6. IF the Sponsorship_Request has already reached the maximum of 3 relay attempts, THEN THE Lifecycle_Manager SHALL NOT create a new Relay_Transaction and SHALL transition the Sponsorship_Request status to "failed"
7. IF the Lifecycle_Manager receives a status update for a Relay_Transaction that violates the valid transition rules (queued→submitted or failed, submitted→confirmed or failed), THEN THE Lifecycle_Manager SHALL reject the update and preserve the existing Relay_Transaction state

### Requirement 5: Duplicate Processing Prevention

**User Story:** As a system operator, I want the worker to prevent duplicate processing of the same sponsorship request, so that wallets are not double-sponsored.

#### Acceptance Criteria

1. WHEN the Sponsorship_Processor begins processing a Sponsorship_Request, THE Processing_Lock SHALL acquire an exclusive lock on the request record using a PostgreSQL row-level SELECT FOR UPDATE SKIP LOCKED mechanism within the processing transaction
2. IF the Processing_Lock cannot be acquired because another process holds the lock, THEN THE Sponsorship_Processor SHALL skip the request without modifying its status and continue to the next item in the batch
3. WHEN the Sponsorship_Processor completes processing a Sponsorship_Request successfully, THE Processing_Lock SHALL release the lock on the request record by committing the enclosing transaction
4. IF the Sponsorship_Processor encounters an unhandled error during processing, THEN THE Processing_Lock SHALL release the lock by rolling back the enclosing transaction within 5 seconds of error detection to prevent permanent lock retention
5. THE Worker SHALL only query for Sponsorship_Requests that are not currently locked by another process during each Poll_Cycle
6. IF a Sponsorship_Processor holds a lock on a single Sponsorship_Request for longer than 30 seconds, THEN THE Worker SHALL terminate the processing operation and release the lock by rolling back the transaction

### Requirement 6: Retry-Safe Processing

**User Story:** As a system operator, I want the worker to handle failures gracefully and support safe retries, so that transient errors do not permanently block sponsorship processing.

#### Acceptance Criteria

1. IF the Sponsorship_Processor encounters a database error during a Status_Transition, THEN THE Sponsorship_Processor SHALL roll back any partial changes from the current transition, log the error including the Sponsorship_Request ID and the attempted Status_Transition, and leave the Sponsorship_Request in its previous status for retry in a subsequent Poll_Cycle
2. IF the Sponsorship_Processor encounters an unhandled exception, THEN THE Sponsorship_Processor SHALL catch the exception, log the error with the Sponsorship_Request ID and exception details, and continue processing the remaining batch items without interruption
3. THE Sponsorship_Processor SHALL treat each Sponsorship_Request independently so that a failure in one request does not affect processing of other requests in the same batch
4. WHEN a Sponsorship_Request fails processing and remains in a non-terminal status (any status other than "rejected", "completed", or "failed"), THE Worker SHALL re-discover the request in a subsequent Poll_Cycle and attempt processing again
5. THE Worker SHALL continue running Poll_Cycles after encountering errors, stopping only when a process termination signal (SIGTERM or SIGINT) is received
6. IF a Sponsorship_Request has been retried 5 or more times without advancing to a terminal status, THEN THE Sponsorship_Processor SHALL transition the Sponsorship_Request to "failed" and log a message indicating the maximum retry limit was reached

### Requirement 7: Timestamp Management

**User Story:** As a system operator, I want sponsorship timestamps updated at each lifecycle stage, so that processing duration and timing can be tracked.

#### Acceptance Criteria

1. WHEN the Lifecycle_Manager transitions a Sponsorship_Request to "approved", THE Lifecycle_Manager SHALL set the `approvedAt` timestamp to the current UTC time with millisecond precision
2. WHEN the Lifecycle_Manager transitions a Sponsorship_Request to "completed", THE Lifecycle_Manager SHALL set the `completedAt` timestamp to the current UTC time with millisecond precision
3. WHEN the Lifecycle_Manager transitions a Sponsorship_Request to "failed", THE Lifecycle_Manager SHALL set the `failedAt` timestamp to the current UTC time with millisecond precision
4. THE Lifecycle_Manager SHALL use the database server time or a consistent clock source for all timestamp assignments within a single processing operation
5. WHEN the Lifecycle_Manager transitions a Sponsorship_Request to "rejected", THE Lifecycle_Manager SHALL set the `rejectedAt` timestamp to the current UTC time with millisecond precision
6. WHEN the Lifecycle_Manager sets a lifecycle timestamp on a Sponsorship_Request, THE Lifecycle_Manager SHALL preserve all previously set timestamp fields unchanged
7. THE Lifecycle_Manager SHALL store all lifecycle timestamps in ISO 8601 format

### Requirement 8: Worker Architecture

**User Story:** As a developer, I want the worker to follow a modular, worker-compatible architecture, so that it can be deployed independently and extended with real integrations later.

#### Acceptance Criteria

1. THE Worker SHALL be structured as an independent application at `apps/worker` within the monorepo, with its own `package.json` declaring `"type": "module"` and a dependency on `@arcpass/shared` via workspace protocol
2. THE Worker SHALL import shared types, constants, and the Prisma client exclusively from the `@arcpass/shared` package
3. THE Worker SHALL use ESM module syntax with TypeScript for all source files
4. THE Worker SHALL load configuration from environment variables using dotenv, and SHALL throw an error indicating the missing or invalid variable name if any required environment variable is absent or fails validation at startup
5. THE Worker SHALL expose exported `start()` and `stop()` functions that return Promises, where `start()` initiates polling and resolves when the worker is actively processing, and `stop()` ceases polling, awaits any in-progress job to complete within 10 seconds, disconnects the Prisma client, and resolves when all resources are released
6. THE Worker SHALL separate concerns into distinct modules: polling logic (scheduling and interval management), processing logic (sponsorship state transitions), relay simulation (blockchain interaction abstraction), and lifecycle management (start, stop, signal handling)
7. THE Worker SHALL use vitest as the test framework, consistent with the existing monorepo test infrastructure
8. WHEN the Worker process receives a SIGTERM or SIGINT signal, THE Worker SHALL invoke the stop sequence and exit with code 0 upon successful cleanup, or exit with code 1 if cleanup does not complete within 10 seconds
