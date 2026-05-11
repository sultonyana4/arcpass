# Implementation Plan: ArcPass Production Hardening

## Overview

This plan implements production hardening across the API (Fastify/JS) and Worker (TypeScript) services. Tasks are ordered by dependency: shared infrastructure first (config, logger), then API plugins (security headers, CORS, correlation ID, error handler, content-type check), then abuse protection (rate limiting, replay, duplicate guard), then worker resilience, and finally integration wiring and validation tests.

## Tasks

- [x] 1. Rewrite API Config Loader with aggregated validation
  - [x] 1.1 Rewrite `apps/api/src/lib/config.js` to validate all required env vars with aggregated error reporting
    - Validate `DATABASE_URL` (present, non-empty, starts with `postgresql://` or `postgres://`)
    - Validate `PORT` (integer 1–65535, default 4000)
    - Validate `LOG_LEVEL` (one of fatal/error/warn/info/debug/trace, default "info")
    - Parse `CORS_ALLOWED_ORIGINS` as comma-separated list with whitespace trimming
    - Parse `NODE_ENV` for production/development mode detection
    - Parse rate limit config: `RATE_LIMIT_IP_MAX` (default 10), `RATE_LIMIT_WINDOW_MS` (default 3600000), `RATE_LIMIT_BLOCK_DURATION_MS` (default 900000), `RATE_LIMIT_WALLET_MAX` (default 5)
    - Collect all failures and report in single error message, exit code 1
    - Never log sensitive values (only variable names)
    - Export frozen config object
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 14.4_

  - [ ]* 1.2 Write property test for API config validation (Property 8)
    - **Property 8: API Config Validation Rejects Invalid Inputs**
    - Generate env var combinations with missing/invalid values and verify all failures reported in single message with exit code 1
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

- [x] 2. Enhance Worker Logger with depth limit and message truncation
  - [x] 2.1 Enhance `apps/worker/src/logger.ts` with max recursion depth (10 levels) and message truncation (10,000 chars)
    - Add `maxDepth` parameter to `filterSensitiveData` (default 10), replace objects beyond depth with `[REDACTED]`
    - Truncate `message` field at 10,000 characters
    - Ensure credential URL pattern covers all `http(s)://user:pass@host` variants
    - _Requirements: 12.1, 12.4, 12.5, 14.1, 14.6_

  - [ ]* 2.2 Write property test for structured log format (Property 14)
    - **Property 14: Structured Log Format**
    - Generate random messages and context objects, verify output is single-line valid JSON with required fields
    - **Validates: Requirements 12.1, 12.2, 12.6**

  - [ ]* 2.3 Write property test for sensitive data redaction (Property 15)
    - **Property 15: Sensitive Data Redaction in Logs**
    - Generate objects with sensitive keys at various nesting depths, verify all are replaced with `[REDACTED]`/`[REDACTED_URL]`
    - **Validates: Requirements 12.3, 12.4, 12.5, 14.1, 14.6**

- [x] 3. Implement Security Headers Plugin
  - [x] 3.1 Create `apps/api/src/plugins/security-headers.js` as a Fastify plugin
    - Register `onSend` hook to attach all security headers to every response
    - Set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`
    - Set `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
    - Set `Cache-Control: no-store`
    - Conditionally set `Strict-Transport-Security: max-age=31536000; includeSubDomains` when HTTPS enabled
    - Remove `X-Powered-By` header
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [ ]* 3.2 Write property test for security headers (Property 17)
    - **Property 17: Security Headers Present on All Responses**
    - Generate various request types (methods, paths, error conditions), verify all required headers present and `X-Powered-By` absent
    - **Validates: Requirements 15.1, 15.2, 15.4, 15.5, 15.6, 15.7**

- [x] 4. Implement CORS Plugin
  - [x] 4.1 Create `apps/api/src/plugins/cors.js` as a custom Fastify plugin
    - Parse `CORS_ALLOWED_ORIGINS` from config (comma-separated, trimmed)
    - If empty/unset, omit all CORS headers (block all cross-origin)
    - If origin not in allowlist, omit all `Access-Control-*` headers
    - For allowed origins: set `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization`
    - Never send `Access-Control-Allow-Credentials: true`
    - Handle preflight OPTIONS requests with 204 for allowed origins
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [ ]* 4.2 Write property test for CORS allowlist enforcement (Property 18)
    - **Property 18: CORS Origin Allowlist Enforcement**
    - Generate origin/allowlist combinations, verify correct header presence/absence
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.7**

- [x] 5. Implement Correlation ID Plugin
  - [x] 5.1 Create `apps/api/src/plugins/correlation-id.js` as a Fastify plugin
    - Register `onRequest` hook to read `X-Request-ID` header
    - If valid (1–128 printable ASCII chars), use as correlation ID
    - If invalid (empty, >128 chars, non-printable), generate UUID v4 via `crypto.randomUUID()`
    - Attach to `request.correlationId` for downstream use
    - Register `onSend` hook to add `X-Request-ID` to all responses (including errors)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 5.2 Write property test for correlation ID lifecycle (Property 16)
    - **Property 16: Correlation ID Lifecycle**
    - Generate X-Request-ID header values of various lengths and character sets, verify correct acceptance/generation behavior
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.5**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Error Handler Plugin
  - [x] 7.1 Create `apps/api/src/plugins/error-handler.js` as a Fastify plugin replacing inline error handler in `server.js`
    - Map all known error classes to HTTP status codes with standardized `{error, statusCode}` shape
    - JSON parse errors → 400 "Invalid JSON in request body"
    - Schema validation errors → 400 with field-level description (no raw JSON Schema keywords)
    - Unknown errors → 500 "Internal server error" (log full stack internally)
    - Production mode (`NODE_ENV=production`): only `{error, statusCode}`, no additional fields
    - Development mode: include `errorName` but never stack traces or paths
    - Ensure `statusCode` in body matches HTTP response status code
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 14.2, 14.3, 14.5_

  - [ ]* 7.2 Write property test for error response shape invariant (Property 1)
    - **Property 1: Error Response Shape Invariant**
    - Generate random error types and messages, verify response body is valid JSON with exactly `error` (non-empty string) and `statusCode` (integer matching HTTP status)
    - **Validates: Requirements 1.1, 1.6, 14.3**

  - [ ]* 7.3 Write property test for error sanitization (Property 2)
    - **Property 2: Error Sanitization — No Internal Leakage**
    - Generate errors containing file paths, stack traces, env values, DB queries, verify none appear in response body
    - **Validates: Requirements 1.2, 1.5, 14.2**

- [x] 8. Implement Content-Type Validation and 404/405 Handlers
  - [x] 8.1 Create `apps/api/src/plugins/content-type-check.js` as a Fastify `preHandler` hook
    - On POST routes, reject requests where `Content-Type` is not `application/json`
    - Return 400: `{ "error": "Content-Type must be application/json", "statusCode": 400 }`
    - _Requirements: 2.6_

  - [x] 8.2 Create `apps/api/src/plugins/not-found-handler.js` for 404 and 405 responses
    - 404: `{ "error": "Not found", "statusCode": 404 }` — no path echo, no route suggestions, no internal identifiers
    - 405: `{ "error": "Method not allowed", "statusCode": 405 }` with `Allow` header listing supported methods
    - HEAD on GET routes: respond with same status/headers but empty body
    - Identical 404 response regardless of HTTP method or path
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 18.1, 18.2, 18.3_

  - [ ]* 8.3 Write property test for 405 handling (Property 19)
    - **Property 19: 405 Method Not Allowed Handling**
    - Generate method/route combinations for defined routes with unsupported methods, verify 405 with Allow header
    - **Validates: Requirements 17.1, 17.2, 17.3**

  - [ ]* 8.4 Write property test for 404 consistency (Property 20)
    - **Property 20: 404 Not Found Consistency**
    - Generate random paths and HTTP methods, verify identical 404 response with no additional fields
    - **Validates: Requirements 18.1, 18.2, 18.3**

- [x] 9. Harden Request Payload Validation Schemas
  - [x] 9.1 Update all route schemas in `apps/api/src/routes/` with strict validation
    - Enforce `walletAddress` pattern: `^0x[0-9a-fA-F]{40}$` with `maxLength: 42`
    - Add `additionalProperties: false` to all body schemas
    - Add `maxLength: 1024` default on all string fields unless field-specific limit defined
    - Ensure UUID params use `format: 'uuid'` for RFC 4122 validation
    - Ensure required fields are explicitly listed in all schemas
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 9.2 Write property test for payload validation (Property 3)
    - **Property 3: Request Payload Validation Rejects Invalid Input**
    - Generate invalid wallet addresses, extra properties, oversized strings, non-JSON content types, invalid UUIDs — verify all rejected with 400
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6**

- [x] 10. Implement IP Rate Limiting Middleware
  - [x] 10.1 Refactor `apps/api/src/services/rate-limit.service.js` to use config from the new Config Loader
    - Read `rateLimitIpMax`, `rateLimitWindowMs`, `rateLimitBlockDurationMs` from frozen config instead of re-reading env vars
    - Ensure sliding window logic: block at threshold, reject while blocked with correct `Retry-After`, reset on window expiry, clear block after `blockedUntil` passes
    - Identify client IP via `X-Forwarded-For` header, fallback to direct connection IP
    - Apply to all public endpoints
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 10.2 Write property test for IP rate limit state machine (Property 4)
    - **Property 4: IP Rate Limit State Machine Correctness**
    - Generate request sequences with timing, verify blocking at threshold, correct Retry-After, reset on window expiry, block clearing
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.5**

- [x] 11. Implement Wallet Rate Limiting and Replay Protection
  - [x] 11.1 Refactor wallet rate limiting in `apps/api/src/services/rate-limit.service.js` to use config values
    - Read `rateLimitWalletMax` from config
    - Apply wallet throttle on `POST /sponsorship/request` only
    - Block wallet at threshold with correct `Retry-After`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 11.2 Create `apps/api/src/plugins/replay-protection.js` as a `preHandler` hook on `POST /sponsorship/request`
    - Check RateLimit table for matching wallet+IP composite key within 5-second window
    - Use `identifierType: 'ip'` with composite identifier `{wallet}:{ip}`
    - Duplicate detected → 429 with `Retry-After` header (remaining seconds in window)
    - Not duplicate → record timestamp for future comparison
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 11.3 Write property test for wallet rate limit state machine (Property 5)
    - **Property 5: Wallet Rate Limit State Machine Correctness**
    - Generate wallet request sequences with timing, verify identical state machine behavior to IP rate limiter
    - **Validates: Requirements 4.1, 4.2, 4.4, 4.5**

  - [ ]* 11.4 Write property test for replay protection window (Property 7)
    - **Property 7: Replay Protection Window**
    - Generate (wallet, IP, timestamp) sequences within/outside 5s window, verify correct acceptance/rejection
    - **Validates: Requirements 6.1, 6.2, 6.4**

- [x] 12. Enhance Duplicate Sponsorship Guard
  - [x] 12.1 Rewrite `apps/api/src/lib/sponsorship-validation.js` `validateNoPendingRequest` to check all active statuses
    - Reject if any sponsorship in `pending`, `approved`, or `relayed` status exists → 400 "sponsorship already in progress"
    - Reject if any `completed` sponsorship exists → 400 "wallet has already been sponsored"
    - Allow new request only if most recent is `failed`/`rejected` with no `completed`
    - Handle concurrent submissions: at most one accepted (rely on row-level locking)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 12.2 Write property test for sponsorship eligibility (Property 6)
    - **Property 6: Sponsorship Eligibility Based on Existing Status**
    - Generate wallet states with various sponsorship status combinations, verify correct accept/reject behavior
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 12.3 Write property test for concurrent duplicate sponsorship (Property 21)
    - **Property 21: Concurrent Duplicate Sponsorship — At Most One Accepted**
    - Simulate concurrent requests for same wallet, verify at most one creates a record
    - **Validates: Requirements 5.4**

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Enhance Worker Config Validation
  - [x] 14.1 Verify and harden `apps/worker/src/config.ts` validation against requirements
    - Ensure `DATABASE_URL` presence is validated
    - Ensure `CHAIN_RPC_URL` starts with `http://` or `https://`
    - Ensure `SPONSOR_PRIVATE_KEY` is 64-char hex (case-insensitive, optional `0x` prefix)
    - Ensure contract addresses match `0x` + 40 hex chars
    - Ensure `CHAIN_ID` is positive integer > 0
    - Ensure all failures collected and reported in single error message
    - Ensure sensitive values never logged (only variable names)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 14.4_

  - [ ]* 14.2 Write property test for worker config validation (Property 9)
    - **Property 9: Worker Config Validation Rejects Invalid Inputs**
    - Generate env var combinations with missing/invalid values, verify all failures reported in single message with exit code 1
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7**

- [x] 15. Enhance Worker Poller Resilience
  - [x] 15.1 Verify and harden `apps/worker/src/poller.ts` error recovery behavior
    - Ensure database connection errors during poll cycle are caught, logged, and next cycle scheduled
    - Ensure unhandled exceptions from request processing are caught and don't crash the process
    - Ensure stale execution detection query includes `relayed` status with no active relay transactions
    - Verify ordering by `requestedAt` ASC and `BATCH_SIZE` limit
    - _Requirements: 9.1, 9.4, 9.6, 11.1_

  - [ ]* 15.2 Write property test for poller resilience (Property 10)
    - **Property 10: Poller Resilience to Errors**
    - Generate various exception types during poll cycle, verify all caught with next cycle scheduled
    - **Validates: Requirements 9.1, 9.6**

- [x] 16. Enhance Relay Executor Timeout and Retry Logic
  - [x] 16.1 Enhance `apps/worker/src/relay-executor.ts` with explicit timeout handling
    - Add `AbortController` with `TX_TIMEOUT_MS` deadline for transaction confirmation wait
    - On timeout: return failed `RelayResult` with `failureReason: "Transaction confirmation timeout"`
    - Log timeout at error level with transaction hash, elapsed time, and sponsorship request ID
    - Default `TX_TIMEOUT_MS` to 120000ms if not set
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 16.2 Verify max retries enforcement in `apps/worker/src/processor.ts`
    - Ensure retry count check uses `>=` comparison against `MAX_RETRIES`
    - Ensure sponsorship transitions to `failed` when retries exhausted
    - Ensure no new relay transaction created when at limit
    - Ensure stale executions with retries < MAX_RETRIES get new relay transaction with correct `relayAttempt`
    - _Requirements: 9.3, 9.5, 11.2, 11.3, 11.4_

  - [ ]* 16.3 Write property test for max retries boundary (Property 11)
    - **Property 11: Max Retries Boundary Enforcement**
    - Generate sponsorship requests with varying relay transaction counts, verify correct fail/retry behavior at boundary
    - **Validates: Requirements 9.3, 9.5, 11.3**

  - [ ]* 16.4 Write property test for stale execution detection (Property 12)
    - **Property 12: Stale Execution Detection and Recovery**
    - Generate sponsorship requests in `relayed` status with various relay transaction states, verify correct inclusion in poll batch and recovery
    - **Validates: Requirements 9.4, 11.1, 11.2**

  - [ ]* 16.5 Write property test for transaction timeout (Property 13)
    - **Property 13: Transaction Timeout Produces Failed Result**
    - Simulate relay executions exceeding TX_TIMEOUT_MS, verify failed RelayResult with timeout reason
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5**

- [x] 17. Wire All Plugins into API Server
  - [x] 17.1 Update `apps/api/src/server.js` to register all new plugins in correct order
    - Register CORS plugin (first — handles preflight)
    - Register security headers plugin
    - Register correlation ID plugin
    - Register content-type check plugin
    - Register replay protection plugin
    - Register error handler plugin (replaces inline `setErrorHandler`)
    - Register not-found handler (404/405)
    - Remove inline error handler code from server.js
    - Disable Fastify's default `X-Powered-By` behavior
    - Wire rate limiting into route handlers (IP rate limit on all routes, wallet rate limit on sponsorship)
    - _Requirements: 1.1, 13.4, 15.5, 16.1_

- [x] 18. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Implement Hardening Validation Test Suite
  - [x] 19.1 Create `tests/validation/hardening.validation.test.ts` covering all hardening requirements
    - Test malformed payloads (missing fields, invalid JSON, non-JSON content-type) → 400 with `error` field
    - Test rate limiting (>10 requests in window) → 429 with `Retry-After` header
    - Test undefined routes → 404 responses
    - Test unsupported HTTP methods on defined routes → 405 with `Allow` header
    - Test security headers present on all response types
    - Test correlation ID generation and passthrough
    - Test error response shape consistency
    - Test sensitive data not leaked in error responses
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8_

- [x] 20. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (21 properties total, 16 implemented as PBT)
- Unit tests validate specific examples and edge cases
- The API uses JavaScript (apps/api), the Worker uses TypeScript (apps/worker)
- Property-based tests use fast-check and are located in `tests/validation/properties/`
- All plugins follow Fastify plugin pattern with `fastify-plugin` wrapper for encapsulation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "14.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.1", "4.1", "5.1", "14.2"] },
    { "id": 2, "tasks": ["3.2", "4.2", "5.2", "7.1", "8.1", "8.2", "9.1"] },
    { "id": 3, "tasks": ["7.2", "7.3", "8.3", "8.4", "9.2", "10.1", "15.1"] },
    { "id": 4, "tasks": ["10.2", "11.1", "11.2", "12.1", "15.2", "16.1", "16.2"] },
    { "id": 5, "tasks": ["11.3", "11.4", "12.2", "12.3", "16.3", "16.4", "16.5"] },
    { "id": 6, "tasks": ["17.1"] },
    { "id": 7, "tasks": ["19.1"] }
  ]
}
```
