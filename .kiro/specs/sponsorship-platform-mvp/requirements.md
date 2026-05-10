# Requirements Document

## Introduction

This document defines the requirements for the ArcPass Sponsorship Platform MVP — the first fully usable end-to-end sponsorship system connecting the API layer, sponsorship lifecycle, wallet registry, real relay execution, and a minimal smart contract layer. The MVP enables testnet deployment, grant demonstrations, investor walkthroughs, and real blockchain sponsorship execution on Arc Network.

The system solves the cold-start gas problem by sponsoring the first onboarding transaction for eligible wallets. This phase builds on existing infrastructure (Fastify API, PostgreSQL, Prisma ORM, Dockerized worker, viem relay execution, wallet foundation, structured logging, monorepo architecture) and connects all components into a cohesive, production-grade flow.

## Glossary

- **Sponsorship_Engine**: The backend system responsible for managing the full sponsorship lifecycle from request to on-chain confirmation
- **State_Machine**: The deterministic component that governs sponsorship request status transitions
- **Wallet_Registry**: The service responsible for wallet lookup, activity tracking, blocking, and sponsorship history
- **API_Gateway**: The Fastify HTTP layer that exposes sponsorship, wallet, and relay endpoints
- **Relay_Worker**: The background process that polls for approved sponsorship requests and executes on-chain transactions via viem
- **SponsorVault_Contract**: The Solidity smart contract responsible for treasury custody and sponsorship authorization
- **SponsorshipRegistry_Contract**: The Solidity smart contract responsible for on-chain sponsorship event emission, accounting, and verification
- **Contract_Integration_Layer**: The viem-based service that interacts with deployed smart contracts to emit events and persist results
- **Observability_System**: The structured logging and visibility layer for sponsorship lifecycle, worker execution, and relay status
- **Config_Validator**: The module responsible for validating environment configuration including RPC URLs, private keys, and deployment parameters

## Requirements

### Requirement 1: Sponsorship State Machine

**User Story:** As a platform operator, I want a deterministic sponsorship state machine, so that every sponsorship request follows a predictable, auditable lifecycle from submission to on-chain confirmation.

#### Acceptance Criteria

1. THE State_Machine SHALL enforce the sponsorship request transition sequence: pending → approved → relayed → completed, with pending also allowing transition to rejected, and relayed also allowing transition to failed
2. THE State_Machine SHALL enforce the relay transaction transition sequence: queued → submitted → confirmed, with queued also allowing transition to failed, and submitted also allowing transition to failed
3. THE State_Machine SHALL enforce terminal states: rejected, completed, and failed for sponsorship requests; confirmed and failed for relay transactions (no transitions out of terminal states)
4. WHEN a transition is attempted that violates the allowed transition map, THE State_Machine SHALL reject the transition and return an error indicating the current status, the attempted status, and that the transition is not permitted
5. THE State_Machine SHALL record a timestamp for each status transition by setting the corresponding date field (approvedAt, rejectedAt, completedAt, failedAt for sponsorship requests; submittedAt, confirmedAt, failedAt for relay transactions)
6. WHEN a relay transaction enters the "submitted" status, THE State_Machine SHALL store the associated transaction hash as a non-empty string of at most 255 characters
7. WHEN a relay transaction enters the "confirmed" status, THE State_Machine SHALL store the block number of the confirming block as a positive integer
8. IF a relay transaction remains in "submitted" status longer than the configured timeout (default: 120000 ms, valid range: 10000–600000 ms), THEN THE Sponsorship_Engine SHALL transition the relay transaction to "failed" with a failure reason indicating timeout
9. THE State_Machine SHALL prevent duplicate sponsorship requests for the same wallet when a non-terminal request (status is pending, approved, or relayed) already exists for that wallet
10. WHEN a relay transaction transitions to "failed", THE Sponsorship_Engine SHALL evaluate retry eligibility by comparing the current relay attempt number against the configured maximum retry count (default: 5, valid range: 1–10), and IF the attempt count is below the maximum, THEN THE Sponsorship_Engine SHALL create a new relay transaction with an incremented attempt number
11. WHILE processing a sponsorship request status transition, THE State_Machine SHALL acquire a database-level row lock on the sponsorship request record to prevent concurrent modifications to the same request

### Requirement 2: Wallet Registry

**User Story:** As a platform operator, I want a complete wallet registry, so that I can look up wallets, track sponsorship history, detect abuse, and block malicious actors.

#### Acceptance Criteria

1. WHEN a wallet address is queried via the lookup endpoint, THE Wallet_Registry SHALL return the wallet record containing: id (UUID), walletAddress (normalized), firstSeenAt (ISO 8601 timestamp), lastSeenAt (ISO 8601 timestamp), sponsorshipCount (integer), and isBlocked (boolean)
2. WHEN a wallet's sponsorship history is requested, THE Wallet_Registry SHALL return all sponsorship requests associated with that wallet ordered by requestedAt descending, with cursor-based pagination (default page size: 50, maximum page size: 100)
3. THE Wallet_Registry SHALL maintain the sponsorshipCount field on the wallet record, incrementing it each time a new sponsorship request is created for that wallet via the registerWallet function
4. WHEN a wallet is marked as blocked, THE Wallet_Registry SHALL set isBlocked to true and record the blockReason (string up to 500 characters), and all subsequent sponsorship requests for that wallet SHALL be rejected
5. WHEN a blocked wallet attempts to request sponsorship, THE Wallet_Registry SHALL reject the request with HTTP status 403 and an error response body containing the message "Wallet is blocked" and statusCode 403
6. THE Wallet_Registry SHALL expose a query that returns the count of unique wallets that have at least one sponsorship request in "completed" status
7. THE Wallet_Registry SHALL integrate with the rate limiting system such that each sponsorship request increments both the IP-based counter (max 10 per 1-hour window) and the wallet-based counter (max 5 per 1-hour window), with automatic blocking for 15 minutes when either limit is exceeded
8. WHEN a wallet record does not exist for a queried address, THE Wallet_Registry SHALL return null without creating a new record (read-only lookup behavior)

### Requirement 3: API Integration

**User Story:** As a developer integrating with ArcPass, I want complete API endpoints for sponsorship requests, status checks, wallet history, and relay lookups, so that I can build applications on top of the sponsorship platform.

#### Acceptance Criteria

1. THE API_Gateway SHALL expose a POST endpoint for creating sponsorship requests that validates wallet address format (42-character string starting with 0x followed by 40 hexadecimal characters), checks eligibility, and returns the created request with a UUID identifier and a 201 status code
2. THE API_Gateway SHALL expose a GET endpoint for retrieving sponsorship request status by request UUID, including current status, timestamps (requestedAt, approvedAt, rejectedAt, completedAt, failedAt), and associated relay transaction details
3. THE API_Gateway SHALL expose a GET endpoint for retrieving wallet sponsorship history by wallet address, returning cursor-based paginated results with a default page size of 50 and a maximum page size of 100
4. THE API_Gateway SHALL expose a GET endpoint for retrieving relay transaction details by relay transaction UUID, including status, relay attempt number, transaction hash, and timestamps
5. THE API_Gateway SHALL expose a GET endpoint for looking up a sponsorship request by on-chain transaction hash (string up to 255 characters)
6. WHEN the API_Gateway receives a sponsorship request, THE API_Gateway SHALL invoke rate limiting checks for both IP address (maximum 10 requests per 1-hour window) and wallet address (maximum 5 requests per 1-hour window) before processing the request
7. IF a rate limit check fails, THEN THE API_Gateway SHALL return a 429 status code with an error response and a Retry-After header indicating the number of seconds until the block expires
8. THE API_Gateway SHALL return structured JSON error responses with a consistent shape containing an error message field and a statusCode field for all error conditions
9. THE API_Gateway SHALL validate all request inputs using JSON Schema before invoking service logic, and return a 400 status code with an error response when validation fails
10. IF a requested resource (sponsorship request, relay transaction, or transaction hash) is not found, THEN THE API_Gateway SHALL return a 404 status code with an error response indicating the resource was not found

### Requirement 4: Smart Contract Layer

**User Story:** As a platform architect, I want minimal Solidity smart contracts for treasury custody and sponsorship accounting, so that sponsorship authorization and verification happen on-chain with transparency.

#### Acceptance Criteria

1. THE SponsorVault_Contract SHALL hold native token funds designated for sponsorship and restrict withdrawals to the authorized operator address set by the contract owner
2. WHEN the authorized operator calls the sponsored transfer function with a valid recipient and amount, THE SponsorVault_Contract SHALL transfer the specified amount of native tokens to the recipient wallet address
3. WHEN a sponsored transfer completes successfully, THE SponsorshipRegistry_Contract SHALL emit an event containing the recipient wallet address (indexed), sponsorship amount, and block timestamp
4. THE SponsorshipRegistry_Contract SHALL maintain an on-chain mapping of wallet addresses to sponsorship count for verification purposes
5. THE SponsorshipRegistry_Contract SHALL expose a view function that returns a boolean indicating whether a given wallet address has a sponsorship count greater than zero
6. THE SponsorVault_Contract SHALL validate that the sponsorship amount does not exceed the owner-configured per-transaction limit and SHALL revert the transaction if the amount exceeds the limit
7. IF the recipient wallet address already has a sponsorship count greater than zero in the SponsorshipRegistry_Contract, THEN THE SponsorVault_Contract SHALL revert the transaction
8. IF the SponsorVault_Contract native token balance is less than the requested sponsorship amount, THEN THE SponsorVault_Contract SHALL revert the transaction
9. THE SponsorVault_Contract SHALL restrict the following functions to the designated owner address: updating the operator address, updating the per-transaction limit, and emergency fund withdrawal

### Requirement 5: Smart Contract Integration

**User Story:** As a platform operator, I want the worker to interact with deployed smart contracts via viem, so that sponsorship events are emitted on-chain and contract interaction results are persisted in the database.

#### Acceptance Criteria

1. WHEN a sponsorship relay is executed, THE Contract_Integration_Layer SHALL call the SponsorVault_Contract to authorize and execute the sponsored transfer for the target wallet address
2. WHEN a sponsored transfer transaction receives at least the configured number of block confirmations (between 1 and 50, default 2), THE Contract_Integration_Layer SHALL read the emitted sponsorship event from the transaction receipt and extract the event name, indexed parameters, and non-indexed data fields
3. WHEN a contract interaction is confirmed on-chain, THE Contract_Integration_Layer SHALL persist the transaction hash, block number, and extracted event fields in the relay transaction record within the same database transaction as the status update
4. IF a contract interaction fails due to an on-chain revert, THEN THE Contract_Integration_Layer SHALL decode the revert reason from the transaction receipt and store it as the failure reason (truncated to 1000 characters) on the relay transaction record
5. IF a contract interaction fails due to a non-revert error (RPC timeout, network unavailability, or insufficient funds), THEN THE Contract_Integration_Layer SHALL store the error type and message as the failure reason on the relay transaction record and leave the relay transaction in failed status
6. THE Contract_Integration_Layer SHALL use viem's contract interaction utilities (readContract, writeContract, getContractEvents) for type-safe contract calls
7. THE Contract_Integration_Layer SHALL abort a pending transaction confirmation if no receipt is received within the configured timeout period (between 10000 ms and 600000 ms, default 120000 ms) and mark the relay transaction as failed with a timeout failure reason

### Requirement 6: Testnet Readiness

**User Story:** As a developer preparing for testnet deployment, I want validated environment configuration and deployment-ready architecture, so that the system can be deployed to a testnet without code changes.

#### Acceptance Criteria

1. WHEN the application starts, THE Config_Validator SHALL validate the CHAIN_RPC_URL environment variable format (must start with http:// or https:// and contain a valid hostname) and reject startup with an error message indicating the invalid variable name and expected format if validation fails
2. WHEN the application starts, THE Config_Validator SHALL validate the SPONSOR_PRIVATE_KEY environment variable format (64-character hexadecimal string with optional 0x prefix, totaling 64 or 66 characters) and reject startup with an error message indicating the invalid variable name and expected format if validation fails
3. WHEN the application starts, THE Config_Validator SHALL validate the CONTRACT_ADDRESS environment variables for SponsorVault and SponsorshipRegistry (42-character string starting with 0x followed by 40 hexadecimal characters) and reject startup with an error message indicating the invalid variable name and expected format if validation fails
4. WHEN the application starts, THE Config_Validator SHALL query the configured RPC endpoint for its chain ID and reject startup with an error message indicating the mismatch if the returned chain ID does not match the configured CHAIN_ID environment variable, within a connection timeout of 10 seconds
5. THE Sponsorship_Engine SHALL read all deployment parameters (CHAIN_RPC_URL, CHAIN_ID, SPONSOR_PRIVATE_KEY, CONTRACT_ADDRESS_SPONSOR_VAULT, CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY, CONFIRMATION_BLOCKS between 1 and 256, RELAY_TIMEOUT_SECONDS between 15 and 300) exclusively from environment variables without requiring code changes
6. THE Sponsorship_Engine SHALL complete a sponsorship relay transaction on a target EVM-compatible testnet when all required environment variables are configured for that testnet, producing a valid transaction hash on the target chain
7. IF any required environment variable (CHAIN_RPC_URL, CHAIN_ID, SPONSOR_PRIVATE_KEY, CONTRACT_ADDRESS_SPONSOR_VAULT, CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY) is missing at startup, THEN THE Config_Validator SHALL reject startup and report an error message listing all missing variable names

### Requirement 7: Observability

**User Story:** As a platform operator, I want structured logging with full lifecycle visibility, so that I can monitor sponsorship processing, diagnose failures, and track relay execution in real time.

#### Acceptance Criteria

1. WHEN a sponsorship request transitions status, THE Observability_System SHALL emit a structured JSON log entry containing the fields: timestamp (ISO 8601), log level, component name, sponsorship request ID, previous status, new status, and a human-readable message
2. WHEN a relay execution attempt occurs, THE Observability_System SHALL emit a structured JSON log entry containing the fields: timestamp (ISO 8601), log level, component name, sponsorship request ID, relay attempt number, transaction hash (when available), and outcome as one of "confirmed", "reverted", or "error" with a failure reason string when outcome is not "confirmed"
3. THE Observability_System SHALL emit structured JSON log entries at log level "info" for worker lifecycle events: startup initiation, shutdown signal received, poll cycle start, and poll cycle completion with the number of requests fetched in the batch
4. WHEN a relay transaction fails, THE Observability_System SHALL log at level "error" the failure reason, relay attempt number, sponsorship request ID, and elapsed time in milliseconds since the relay was submitted
5. THE Observability_System SHALL include the sponsorship request ID as a correlation identifier in every log entry emitted during sponsorship status transitions, relay execution attempts, and relay failure events for that request
6. THE Observability_System SHALL route log entries at level "error" to stderr and all other log entries to stdout, with each entry serialized as a single-line JSON object
7. IF a sponsorship status transition is invalid, THEN THE Observability_System SHALL emit a structured JSON log entry at level "warn" containing the sponsorship request ID, the attempted previous status, the attempted new status, and the reason the transition was rejected

### Requirement 8: Docker Compatibility

**User Story:** As a developer, I want the MVP to preserve existing Docker Compose compatibility, so that the local development environment and CI pipeline continue to work without modification.

#### Acceptance Criteria

1. THE Sponsorship_Engine SHALL retain the existing Docker Compose service definitions (worker, postgres) and their configuration (ports, volumes, healthchecks, depends_on) without removing or renaming any existing service or changing its published port
2. THE Relay_Worker SHALL retain the existing three-stage Dockerfile build process (deps: install workspace dependencies, build: compile TypeScript and create production deploy, runtime: minimal production image) without removing any existing stage
3. THE Relay_Worker SHALL retain the existing entrypoint script lifecycle sequence (run Prisma migrate deploy, then start the worker process) and exit with a non-zero code if migration fails
4. THE Sponsorship_Engine SHALL retain the existing monorepo workspace structure (apps/api, apps/worker, packages/shared) such that existing workspace package references continue to resolve without modification
5. WHEN new environment variables are added for smart contract configuration, THE Sponsorship_Engine SHALL document each variable in the .env.example file with a comment describing its purpose and a placeholder value
6. WHEN `docker compose up --build` is executed against the project root docker-compose.yml, THE Sponsorship_Engine SHALL build all service images and start all containers to a healthy state within 120 seconds on a machine meeting the project's documented prerequisites

### Requirement 9: Security Baseline

**User Story:** As a platform operator, I want security protections against key compromise, replay attacks, input manipulation, and sponsorship abuse, so that the platform operates safely on a public testnet.

#### Acceptance Criteria

1. THE Config_Validator SHALL validate the sponsor private key cryptographically (valid secp256k1 curve point derived via `privateKeyToAccount`) at worker startup before processing any requests
2. IF the sponsor private key is missing, empty, or fails cryptographic validation at startup, THEN THE Config_Validator SHALL terminate the worker process with a non-zero exit code and log an error message identifying the failure without exposing key material
3. THE Sponsorship_Engine SHALL prevent replay of sponsorship requests by enforcing that only one sponsorship request in a non-terminal status (pending, approved, or relayed) may exist per wallet at the database level
4. THE API_Gateway SHALL validate all wallet address inputs against the Ethereum address format (0x followed by 40 case-insensitive hexadecimal characters, 42 characters total) before processing, and return an error response indicating the address format is invalid if validation fails
5. THE Sponsorship_Engine SHALL enforce per-IP rate limits of 10 requests per 1-hour sliding window and per-wallet rate limits of 5 requests per 1-hour sliding window, automatically blocking the offending identifier for 15 minutes when the limit is exceeded
6. THE Relay_Worker SHALL enforce a configurable maximum retry count per sponsorship request (default: 5, valid range: 1–10) and transition the request to failed status without invoking the relay executor when the retry count is reached or exceeded
7. THE Relay_Worker SHALL enforce a configurable transaction timeout (default: 120000 ms, valid range: 10000–600000 ms) and treat any transaction that has not received confirmation within the timeout as failed
8. THE SponsorVault_Contract SHALL restrict sponsored transfer execution to the single authorized operator address and revert the transaction if called by any other address
9. THE API_Gateway SHALL sanitize error responses for unexpected server errors by returning a generic error message without stack traces, database errors, or internal identifiers to external callers
