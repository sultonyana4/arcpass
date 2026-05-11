# Requirements Document

## Introduction

This document specifies the production hardening requirements for the ArcPass infrastructure. The goal is to move ArcPass from a validated development state into a production-safe state suitable for public exposure. The scope covers API hardening, abuse protection, environment safety, worker resilience, observability, and security headers — all within the existing Fastify + Prisma + Worker architecture without introducing new infrastructure components.

## Glossary

- **API_Server**: The Fastify-based HTTP server in `apps/api` that handles sponsorship requests, wallet registration, and relay status queries.
- **Worker**: The TypeScript background process in `apps/worker` that polls for pending sponsorship requests and executes blockchain relay transactions.
- **Poller**: The Worker subsystem that periodically queries the database for pending or stale sponsorship requests.
- **Relay_Executor**: The Worker subsystem that submits and confirms on-chain sponsorship transactions.
- **Rate_Limiter**: The service in `apps/api` that enforces request throttling per IP address and wallet address using the RateLimit database model.
- **Validator**: The request validation layer in the API_Server that checks payload structure and wallet address format.
- **Error_Handler**: The centralized Fastify error handler that maps application errors to standardized HTTP responses.
- **Config_Loader**: The module responsible for reading, validating, and exposing environment configuration at boot time.
- **Logger**: The structured JSON logging system used by both the API_Server and Worker for operational output.
- **Correlation_ID**: A unique identifier attached to an HTTP request that propagates through log entries for traceability.
- **Security_Headers**: HTTP response headers that mitigate common web attack vectors (XSS, clickjacking, MIME sniffing).
- **Stale_Execution**: A sponsorship request stuck in `relayed` status with no active relay transaction due to a prior crash or timeout.

## Requirements

### Requirement 1: Standardized API Error Responses

**User Story:** As a public API consumer, I want all error responses to follow a consistent structure, so that I can reliably parse and handle errors programmatically.

#### Acceptance Criteria

1. THE Error_Handler SHALL return all error responses with the Content-Type `application/json` and a JSON body containing exactly two fields: `"error"` (string, non-empty) and `"statusCode"` (integer matching the HTTP response status code), with no additional properties.
2. WHEN an unhandled exception occurs, THE Error_Handler SHALL return a 500 response with the message "Internal server error" and SHALL NOT include stack traces, internal file paths, database queries, or environment-specific details in the response body.
3. WHEN a Fastify schema validation failure occurs, THE Error_Handler SHALL return a 400 response with a message that identifies the failing field or constraint as reported by Fastify's validator, without exposing raw JSON Schema keywords or internal schema structure.
4. WHEN a JSON parse error occurs in the request body, THE Error_Handler SHALL return a 400 response with the message "Invalid JSON in request body".
5. IF the Error_Handler encounters an error type not explicitly mapped, THEN THE Error_Handler SHALL log the error (including message and stack trace) internally and return a 500 response with the message "Internal server error".
6. THE Error_Handler SHALL ensure the `statusCode` value in the response body is identical to the HTTP status code returned in the response header for every error response.

---

### Requirement 2: Request Payload Validation Hardening

**User Story:** As a system operator, I want the API to reject malformed and invalid payloads early, so that invalid data never reaches business logic.

#### Acceptance Criteria

1. WHEN a request body contains a `walletAddress` field, THE Validator SHALL reject addresses that do not match the pattern `0x` followed by exactly 40 hexadecimal characters (case-insensitive) and return a 400 response with a JSON body containing an `error` field describing the validation failure.
2. WHEN a request body contains unexpected additional properties beyond the defined schema, THE Validator SHALL reject the request with a 400 response with a JSON body containing an `error` field identifying the unexpected properties.
3. WHEN a request body is empty or missing required fields, THE Validator SHALL return a 400 response with a JSON body containing an `error` field specifying which required fields are missing.
4. WHEN a route parameter expected to be a UUID does not match the RFC 4122 UUID format (8-4-4-4-12 hexadecimal characters with hyphens), THE Validator SHALL return a 400 response with a JSON body containing an `error` field indicating the invalid parameter.
5. THE Validator SHALL enforce a maximum length of 1024 characters on all string input fields unless a field-specific limit is defined in the schema, and reject any request exceeding the limit with a 400 response.
6. IF a request is received with a `Content-Type` header that is not `application/json` on routes expecting a JSON body, THEN THE Validator SHALL reject the request with a 400 response with a JSON body containing an `error` field indicating the unsupported content type.

---

### Requirement 3: Rate Limiting and IP Throttling

**User Story:** As a system operator, I want IP-based request throttling enforced on all public endpoints, so that no single source can overwhelm the API.

#### Acceptance Criteria

1. WHEN an IP address exceeds 10 requests (configurable via `RATE_LIMIT_IP_MAX` environment variable) within a 60-minute sliding window (configurable via `RATE_LIMIT_WINDOW_MS` environment variable), THE Rate_Limiter SHALL reject subsequent requests with a 429 status, a `Retry-After` header indicating the number of seconds until the block expires, and SHALL temporarily block that IP for 15 minutes (configurable via `RATE_LIMIT_BLOCK_DURATION_MS` environment variable).
2. WHILE an IP address is temporarily blocked (its `blockedUntil` timestamp is in the future), THE Rate_Limiter SHALL reject all requests from that IP with a 429 status and a `Retry-After` header indicating the remaining seconds until the block expires.
3. WHEN a request arrives from any IP address to any public endpoint (`POST /sponsorship/request`, `GET /sponsorship/:id`, `GET /sponsorship/tx/:hash`, `POST /wallets/register`, `GET /wallets/:address`, `GET /wallets/:address/history`, `GET /relay/:id`), THE Rate_Limiter SHALL increment the request counter for that IP address.
4. WHEN the rate limit window has expired and a new request arrives from the same IP address, THE Rate_Limiter SHALL reset the request counter to 1 and start a new window from the current timestamp.
5. IF the rate limit window expires while an IP is temporarily blocked, THEN THE Rate_Limiter SHALL clear the block and reset the request counter on the next request received after `blockedUntil` has passed.
6. THE Rate_Limiter SHALL identify the client IP address using the `X-Forwarded-For` request header when present, falling back to the direct connection IP address otherwise.

---

### Requirement 4: Wallet Request Throttling

**User Story:** As a system operator, I want per-wallet request throttling, so that a single wallet cannot abuse the sponsorship system.

#### Acceptance Criteria

1. WHEN a wallet address exceeds the configured maximum sponsorship requests (default: 5) within the rate limit window (default: 3600000 ms), THE Rate_Limiter SHALL reject subsequent requests with a 429 status and include a Retry-After value indicating the number of seconds until the block expires.
2. WHILE a wallet address is temporarily blocked due to rate limiting, THE Rate_Limiter SHALL reject all sponsorship requests for that wallet with a 429 status until the block duration (default: 900000 ms) expires.
3. WHEN a `POST /sponsorship/request` is received, THE Rate_Limiter SHALL increment the request counter for the requesting wallet address, creating a new rate limit record with a request count of 1 if none exists for the current window.
4. WHEN the wallet request count reaches the configured maximum within the active window, THE Rate_Limiter SHALL set the wallet's blockedUntil timestamp to the current time plus the configured block duration.
5. WHEN a request arrives for a wallet whose rate limit window has fully elapsed, THE Rate_Limiter SHALL reset the request counter to 1 and start a new window, clearing any previous block.

---

### Requirement 5: Duplicate Sponsorship Protection

**User Story:** As a system operator, I want to prevent duplicate sponsorship requests for wallets that already have an active sponsorship in progress, so that system resources are not wasted.

#### Acceptance Criteria

1. WHEN a sponsorship request is submitted for a wallet that already has a request in `pending`, `approved`, or `relayed` status, THE API_Server SHALL reject the request with a 400 error indicating a sponsorship is already in progress.
2. WHEN a sponsorship request is submitted for a wallet that has a `completed` sponsorship, THE API_Server SHALL reject the request with a 400 error indicating the wallet has already been sponsored.
3. WHEN a sponsorship request is submitted for a wallet whose most recent sponsorship has `failed` or `rejected` status and no `completed` sponsorship exists, THE API_Server SHALL accept the request and create a new sponsorship with `pending` status.
4. IF two sponsorship requests for the same wallet are submitted concurrently and both pass initial validation, THEN THE API_Server SHALL accept at most one request and reject the other with a 400 error indicating a sponsorship is already in progress.
5. WHEN a sponsorship request is rejected due to duplicate protection, THE API_Server SHALL return the response within 2 seconds and SHALL not create a new SponsorshipRequest record for the rejected submission.

---

### Requirement 6: Replay Request Protection

**User Story:** As a system operator, I want to prevent replay attacks where identical requests are submitted in rapid succession, so that the system is not exploited through request duplication.

#### Acceptance Criteria

1. WHEN a sponsorship request arrives from a wallet address that already submitted a request within the preceding 5-second window, THE API_Server SHALL reject the subsequent request with a 429 status code, an error message indicating a duplicate request was detected, and a Retry-After header specifying the number of seconds remaining in the deduplication window.
2. THE API_Server SHALL consider two sponsorship requests as duplicates when they share the same wallet address AND originate from the same IP address within the 5-second deduplication window.
3. THE API_Server SHALL use the existing RateLimit database model with identifierType values of "wallet" and "ip" to record the timestamp of each sponsorship request for deduplication comparison.
4. WHEN the 5-second deduplication window has elapsed since the last request from a given wallet address and IP address combination, THE API_Server SHALL accept a new sponsorship request from that same combination without triggering replay rejection.
5. IF the first request in a deduplication window is still being processed, THEN THE API_Server SHALL still reject any subsequent duplicate request arriving within the 5-second window regardless of the first request's processing status.

---

### Requirement 7: API Environment Validation at Boot

**User Story:** As a system operator, I want the API server to validate all required environment variables at startup, so that misconfigured deployments fail fast with clear error messages.

#### Acceptance Criteria

1. WHEN the API_Server starts, THE Config_Loader SHALL validate that all required environment variables are present and correctly formatted before the server begins accepting connections.
2. IF any required environment variable is missing or invalid, THEN THE Config_Loader SHALL write a single error message to stderr listing all invalid variable names with the reason each failed validation, and terminate the process with exit code 1.
3. THE Config_Loader SHALL validate that `DATABASE_URL` is present, non-empty after trimming whitespace, and begins with the prefix `postgresql://` or `postgres://`.
4. THE Config_Loader SHALL validate that `PORT`, if set, is a valid integer between 1 and 65535 inclusive, and SHALL default to 4000 if `PORT` is not set.
5. THE Config_Loader SHALL validate that `LOG_LEVEL`, if set, is one of the allowed values: fatal, error, warn, info, debug, trace (case-sensitive), and SHALL default to "info" if `LOG_LEVEL` is not set.
6. THE Config_Loader SHALL collect all validation failures and report them in a single aggregated error output rather than terminating on the first validation failure.
7. IF all required environment variables pass validation, THEN THE Config_Loader SHALL make the validated configuration values available to the application without re-reading environment variables.

---

### Requirement 8: Worker Environment Validation at Boot

**User Story:** As a system operator, I want the Worker to validate all required environment variables at startup, so that misconfigured deployments fail fast.

#### Acceptance Criteria

1. WHEN the Worker starts, THE Config_Loader SHALL validate that all required environment variables are present: `DATABASE_URL`, `CHAIN_RPC_URL`, `SPONSOR_PRIVATE_KEY`, `CHAIN_ID`, `CONTRACT_ADDRESS_SPONSOR_VAULT`, `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY`.
2. WHEN the Worker starts, THE Config_Loader SHALL validate that `CHAIN_RPC_URL` starts with `http://` or `https://`.
3. WHEN the Worker starts, THE Config_Loader SHALL validate that `SPONSOR_PRIVATE_KEY` is a 64-character hexadecimal string (case-insensitive, with optional `0x` prefix).
4. WHEN the Worker starts, THE Config_Loader SHALL validate that `CONTRACT_ADDRESS_SPONSOR_VAULT` and `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY` each match the pattern `0x` followed by exactly 40 hexadecimal characters (case-insensitive).
5. WHEN the Worker starts, THE Config_Loader SHALL validate that `CHAIN_ID` is a positive integer greater than 0.
6. WHEN the Worker starts, THE Config_Loader SHALL collect all validation failures from criteria 1 through 5 before reporting, so that a single startup attempt reveals every misconfiguration.
7. IF any validation fails, THEN THE Config_Loader SHALL log a single error message listing all invalid or missing variable names and terminate the process with exit code 1.
8. IF all required environment variables are present and pass format validation, THEN THE Config_Loader SHALL return a valid configuration object and allow the Worker to proceed with normal startup.

---

### Requirement 9: Worker Recovery and Resilience

**User Story:** As a system operator, I want the Worker to recover gracefully from transient failures, so that the relay pipeline does not stall permanently.

#### Acceptance Criteria

1. WHEN the Poller encounters a database connection error during a poll cycle, THE Poller SHALL log the error (including the error message) and schedule the next poll cycle after the configured `POLL_INTERVAL_MS` delay without crashing or terminating the process.
2. WHEN the Relay_Executor encounters a transaction timeout (exceeding `TX_TIMEOUT_MS`, default 120000 ms, configurable range 10000–600000 ms), THE Relay_Executor SHALL return a failed RelayResult with a failure reason indicating timeout, causing the processor to mark the relay transaction as failed with that timeout reason and transition the sponsorship request to `failed` status.
3. WHEN a sponsorship request has a number of existing relay transactions equal to or exceeding the configured `MAX_RETRIES` value (default 5, configurable range 1–10) at the time the processor acquires the row lock, THE Worker SHALL transition the sponsorship request to `failed` status and not create a new relay transaction.
4. WHEN the Worker starts and the Poller executes its first poll cycle, THE Poller SHALL include sponsorship requests in `relayed` status that have no relay transaction with status `submitted` or `confirmed` (stale executions) in the poll batch alongside `pending` requests, ordered by `requestedAt` ascending, limited to `BATCH_SIZE`.
5. THE Worker SHALL enforce a maximum relay attempt boundary per sponsorship request as defined by the `MAX_RETRIES` environment variable (default 5, configurable range 1–10), rejecting creation of a new relay transaction when the existing count meets or exceeds this limit.
6. IF the Poller poll cycle query or any individual request processing throws an unhandled exception, THEN THE Poller SHALL catch the exception, log the error, and continue to schedule the next poll cycle rather than propagating the exception to the Worker process.

---

### Requirement 10: Transaction Confirmation Timeout Handling

**User Story:** As a system operator, I want transaction confirmations to have bounded timeouts, so that the Worker does not hang indefinitely waiting for blockchain confirmations.

#### Acceptance Criteria

1. WHEN a submitted transaction does not receive a transaction receipt within `TX_TIMEOUT_MS` after broadcast, THE Relay_Executor SHALL update the RelayTransaction record by setting status to "failed", failedAt to the current timestamp, and failureReason to "Transaction confirmation timeout".
2. THE Relay_Executor SHALL use the configured `TX_TIMEOUT_MS` value (default 120000ms, valid range 10000–600000ms) as the maximum wait time for transaction confirmation after the transaction hash has been obtained from broadcast.
3. WHEN a timeout occurs, THE Relay_Executor SHALL log the timeout event at error level with the transaction hash, elapsed time in milliseconds, and sponsorship request ID.
4. IF `TX_TIMEOUT_MS` is not set or is empty, THEN THE Relay_Executor SHALL use the default value of 120000ms without failing startup.
5. IF a timeout occurs and the relay attempt count is less than the configured `MAX_RETRIES`, THEN THE Relay_Executor SHALL allow the sponsorship request to be retried on a subsequent polling cycle.

---

### Requirement 11: Stale Execution Cleanup

**User Story:** As a system operator, I want stale sponsorship executions to be detected and recovered, so that no request is permanently stuck.

#### Acceptance Criteria

1. WHEN the Poller queries for work, THE Poller SHALL include sponsorship requests in `relayed` status where none of their associated relay transactions have a status of `submitted` or `confirmed`, ordered by `requestedAt` ascending alongside pending requests within the configured batch size (1–100, default 20).
2. WHEN a stale execution is detected and the total number of existing relay transactions for that sponsorship request is less than the configured maximum retries (1–10, default 5), THE Worker SHALL create a new relay transaction with `relayAttempt` set to the previous count plus one and process it through the standard relay lifecycle.
3. IF the total number of existing relay transactions for a stale execution equals or exceeds the configured maximum retries, THEN THE Worker SHALL transition the sponsorship request to `failed` status with the `failedAt` timestamp set to the current UTC time.
4. WHILE processing a stale execution recovery, THE Worker SHALL acquire a row-level lock (SELECT FOR UPDATE SKIP LOCKED) on the sponsorship request to prevent concurrent recovery attempts by other worker instances.

---

### Requirement 12: Structured Production Logging

**User Story:** As a system operator, I want all runtime logs to be structured JSON with consistent fields, so that logs are machine-parseable and searchable in production log aggregators.

#### Acceptance Criteria

1. THE Logger SHALL output all log entries as single-line JSON objects with fields: `timestamp` (ISO 8601 format, e.g. `2024-01-15T09:30:00.000Z`), `level` (one of `info`, `warn`, `error`), `component` (identifier of the emitting module), and `message` (string, maximum 10,000 characters, truncated if exceeded).
2. IF contextual fields (request ID, wallet address, transaction hash) are provided to the log call, THEN THE Logger SHALL include them as additional top-level fields in the JSON output.
3. THE Logger SHALL never include sensitive values (private keys, database credentials, authorization tokens) in log output.
4. WHEN a log entry contains a field matching sensitive key patterns (privatekey, secret, password, mnemonic, credential, authorization), THE Logger SHALL replace the value with `[REDACTED]`, including fields nested within child objects at any depth.
5. WHEN a log entry contains a URL with embedded credentials (user:pass@host pattern), THE Logger SHALL replace the value with `[REDACTED_URL]`.
6. WHEN a log entry has level `error`, THE Logger SHALL write the JSON line to stderr; WHEN a log entry has level `info` or `warn`, THE Logger SHALL write the JSON line to stdout.

---

### Requirement 13: Request Correlation IDs

**User Story:** As a system operator, I want each API request to carry a unique correlation ID through all log entries, so that I can trace a single request across the system.

#### Acceptance Criteria

1. WHEN the API_Server receives a request without an `X-Request-ID` header, THE API_Server SHALL generate a unique Correlation_ID (UUID v4) and attach it to the request context.
2. WHEN the API_Server receives a request with an `X-Request-ID` header containing a value between 1 and 128 printable ASCII characters, THE API_Server SHALL use the provided value as the Correlation_ID instead of generating a new one.
3. IF the API_Server receives a request with an `X-Request-ID` header that is empty or exceeds 128 characters, THEN THE API_Server SHALL ignore the provided value and generate a new UUID v4 as the Correlation_ID.
4. THE API_Server SHALL include the Correlation_ID as a field in every structured log entry produced during request processing.
5. THE API_Server SHALL include the Correlation_ID in every HTTP response (including error responses) via the `X-Request-ID` header.

---

### Requirement 14: Sensitive Data Leakage Prevention

**User Story:** As a security engineer, I want to ensure that sensitive environment variables and secrets are never exposed in logs, error responses, or stack traces, so that credentials remain protected.

#### Acceptance Criteria

1. THE Logger SHALL filter all log output through the sensitive data filter before writing, replacing any field whose key matches the sensitive key patterns (`privatekey`, `private_key`, `mnemonic`, `secret`, `password`, `credential`, `authorization` — case-insensitive) with the literal string `[REDACTED]`, and replacing any string value matching a credential-bearing URL pattern (`http(s)://user:pass@host`) with `[REDACTED_URL]`.
2. THE Error_Handler SHALL never include environment variable values, absolute or relative file system paths, or stack traces in HTTP responses sent to clients.
3. WHILE the API_Server is running in production mode (`NODE_ENV=production`), THE Error_Handler SHALL return only the standardized error response structure `{ "error": "<message>", "statusCode": <number> }` with no additional fields, suppressing all diagnostic detail including error names, validation specifics, and internal identifiers.
4. THE Config_Loader SHALL never log the values of `SPONSOR_PRIVATE_KEY`, `DATABASE_URL`, or any field matching the sensitive key patterns defined in criterion 1 during startup validation, and SHALL log only the presence or absence of each required variable without revealing its value.
5. WHILE the API_Server is running in development mode (`NODE_ENV` not equal to `production`), THE Error_Handler SHALL include the error message and error name in the response body but SHALL NOT include stack traces, file paths, or environment variable values.
6. IF the sensitive data filter encounters a nested object, THEN THE Logger SHALL recursively apply the filter to all nested levels with a maximum recursion depth of 10 levels, treating any object beyond that depth as `[REDACTED]`.

---

### Requirement 15: HTTP Security Headers

**User Story:** As a security engineer, I want the API to include standard security headers on all responses, so that common web attack vectors are mitigated.

#### Acceptance Criteria

1. THE API_Server SHALL include the `X-Content-Type-Options: nosniff` header on all responses, including success, error, 404, and 405 responses.
2. THE API_Server SHALL include the `X-Frame-Options: DENY` header on all responses, including success, error, 404, and 405 responses.
3. WHILE the API_Server is served over HTTPS, THE API_Server SHALL include the `Strict-Transport-Security: max-age=31536000; includeSubDomains` header on all responses.
4. THE API_Server SHALL include the `X-XSS-Protection: 0` header on all responses.
5. THE API_Server SHALL NOT include the `X-Powered-By` header in any response.
6. THE API_Server SHALL include a `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` header on all responses.
7. THE API_Server SHALL include a `Cache-Control: no-store` header on all responses to prevent caching of API responses by intermediaries.

---

### Requirement 16: CORS Configuration

**User Story:** As a system operator, I want CORS to be explicitly configured, so that only authorized origins can make cross-origin requests to the API.

#### Acceptance Criteria

1. THE API_Server SHALL configure CORS with an explicit allowlist of permitted origins parsed from the `CORS_ALLOWED_ORIGINS` environment variable, where the value is a comma-separated list of origin URLs with optional whitespace around entries trimmed.
2. WHEN a preflight request arrives from an origin not in the allowlist, THE API_Server SHALL respond without any `Access-Control-Allow-Origin` header, causing the browser to block the cross-origin request.
3. WHEN a simple or actual cross-origin request arrives from an origin not in the allowlist, THE API_Server SHALL omit the `Access-Control-Allow-Origin` header from the response.
4. THE API_Server SHALL restrict allowed HTTP methods to GET, POST, and OPTIONS via the `Access-Control-Allow-Methods` response header.
5. THE API_Server SHALL include only `Content-Type` and `Authorization` in the `Access-Control-Allow-Headers` response header for permitted origins.
6. IF `CORS_ALLOWED_ORIGINS` is not set or is empty after trimming, THEN THE API_Server SHALL reject all cross-origin requests by omitting CORS headers from every response.
7. THE API_Server SHALL NOT enable credentials support (SHALL NOT send `Access-Control-Allow-Credentials: true`).

---

### Requirement 17: Unsafe HTTP Method Handling

**User Story:** As a security engineer, I want the API to reject requests using HTTP methods not supported by any route, so that unexpected method usage is blocked.

#### Acceptance Criteria

1. WHEN a request uses an HTTP method not supported by the target route, THE API_Server SHALL return a 405 response with a JSON body containing an "error" field indicating the method is not allowed and a "statusCode" field set to 405.
2. WHEN THE API_Server returns a 405 response, THE API_Server SHALL include an `Allow` header containing a comma-separated list of the HTTP methods supported for the requested route.
3. IF a request targets a path that matches an existing route but uses an unsupported method, THEN THE API_Server SHALL return 405 instead of 404.
4. WHEN a request uses the HEAD method on a route that supports GET, THE API_Server SHALL respond with the same status code and headers as the equivalent GET request but with an empty body.

---

### Requirement 18: Invalid Route Handling

**User Story:** As a security engineer, I want requests to undefined routes to receive a consistent 404 response, so that the API does not leak information about its internal structure.

#### Acceptance Criteria

1. WHEN a request using any HTTP method targets a route not defined in the API_Server, THE API_Server SHALL return a 404 response with Content-Type `application/json` and the body `{ "error": "Not found", "statusCode": 404 }`.
2. THE API_Server SHALL NOT include route suggestions, requested path echo, stack traces, available endpoints, or internal identifiers in 404 responses.
3. WHEN a request targets a route not defined in the API_Server, THE API_Server SHALL return an identical response body and status code regardless of the HTTP method or path used in the request.

---

### Requirement 19: Hardening Validation Test Suite

**User Story:** As a developer, I want automated validation tests covering all hardening requirements, so that production safety can be verified on every deployment.

#### Acceptance Criteria

1. THE validation test suite SHALL include tests verifying that malformed payloads (missing required fields, invalid JSON syntax, and non-JSON content-type bodies) sent to POST /sponsorship/request receive 400 responses with an `error` field in the response body.
2. THE validation test suite SHALL include tests verifying that when more than 10 requests from the same source are sent to POST /sponsorship/request within a 60-second window, subsequent requests receive 429 responses with a `Retry-After` header containing a value in seconds.
3. THE validation test suite SHALL include tests verifying that requests to undefined routes (paths not registered in the API router) receive 404 responses.
4. THE validation test suite SHALL include tests verifying that unsupported HTTP methods (e.g., PUT, PATCH, DELETE) sent to POST-only endpoints receive 405 responses.
5. THE validation test suite SHALL include tests verifying that the headers `X-Content-Type-Options`, `X-Frame-Options`, and `Strict-Transport-Security` are present on all API responses.
6. THE validation test suite SHALL include tests verifying that 500 error responses do not contain stack traces, file paths, or internal variable names in the response body.
7. THE validation test suite SHALL include tests verifying that a second POST /sponsorship/request for the same walletAddress that already has a sponsorship in PENDING or COMPLETED status is rejected with a 409 response.
8. THE validation test suite SHALL include tests verifying that after a simulated poll cycle failure (database query timeout or RPC error), the Worker resumes polling on the next scheduled interval without requiring a manual restart.
