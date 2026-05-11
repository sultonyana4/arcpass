---
title: "Security Model"
description: "Rate limiting, replay protection, wallet restrictions, trust boundaries, and hardening measures for the ArcPass system."
---

# Security Model

This document describes the security mechanisms protecting the ArcPass sponsorship system. Each section identifies the threats being mitigated, the mechanisms used, and the observable system behavior when a threat is detected.

## Rate Limiting

ArcPass enforces rate limiting at two levels — per-IP and per-wallet — using sliding-window counters stored in the `rate_limits` PostgreSQL table.

### IP Rate Limiting

| Parameter | Default Value | Environment Variable |
|-----------|--------------|---------------------|
| Max requests per window | 10 | `RATE_LIMIT_IP_MAX` |
| Window duration | 3,600,000 ms (1 hour) | `RATE_LIMIT_WINDOW_MS` |
| Block duration | 900,000 ms (15 minutes) | `RATE_LIMIT_BLOCK_DURATION_MS` |

**Mechanism**: Each incoming request increments a counter for the client IP address. The counter resets when the window expires. When the counter reaches the configured maximum, the IP is auto-blocked for the block duration.

**Client IP extraction**: The system reads the `X-Forwarded-For` header (first entry) when present, falling back to the direct connection IP (`request.ip`).

### Wallet Rate Limiting

| Parameter | Default Value | Environment Variable |
|-----------|--------------|---------------------|
| Max requests per window | 5 | `RATE_LIMIT_WALLET_MAX` |
| Window duration | 3,600,000 ms (shared) | `RATE_LIMIT_WINDOW_MS` |
| Block duration | 900,000 ms (shared) | `RATE_LIMIT_BLOCK_DURATION_MS` |

**Mechanism**: Identical sliding-window logic applied per wallet address. When the wallet counter reaches the configured maximum, the wallet identifier is auto-blocked.

### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Denial-of-service via request flooding | Sliding-window counter with auto-block | HTTP 429 response with `Retry-After` header indicating seconds until the block expires |
| Resource exhaustion from a single IP | IP-level rate limiting with configurable threshold | Requests from the blocked IP receive HTTP 429 for the block duration |
| Wallet-level abuse (repeated sponsorship attempts) | Wallet-level rate limiting with lower threshold | Requests referencing the blocked wallet receive HTTP 429 |

All thresholds are configurable via environment variables, allowing operators to tune limits without code changes.

## Replay Protection

ArcPass prevents duplicate sponsorship submissions using a 5-second deduplication window.

### Mechanism

- **Scope**: Applied exclusively to `POST /sponsorship/request` via a Fastify `preHandler` hook
- **Composite key**: `{walletAddress}:{clientIp}` — combines the wallet address from the request body with the client IP address
- **Storage**: The composite key is stored in the `rate_limits` table with `identifierType: 'ip'`
- **Window**: 5,000 ms (5 seconds) from the timestamp of the first request

### Flow

1. A `POST /sponsorship/request` arrives with a `walletAddress` in the body
2. The plugin constructs the composite key `{walletAddress}:{clientIp}`
3. It queries the `rate_limits` table for a record matching the composite key with a `windowStart` within the last 5 seconds
4. If a matching record exists, the request is rejected immediately
5. If no matching record exists, the current timestamp is recorded (upsert) and the request proceeds

### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Duplicate submission (double-click, network retry) | 5-second deduplication window with composite key lookup | HTTP 429 with `Retry-After` header and message "Duplicate request detected. Please wait before retrying." |
| Replay attack from same origin | Composite key ties wallet address to client IP, preventing cross-IP replay | Only the original IP+wallet combination is deduplicated; legitimate requests from different IPs proceed normally |

## Wallet Restrictions

ArcPass enforces wallet-level access control through blocking and eligibility validation at multiple system layers.

### Blocking Mechanism

The `Wallet` model includes an `isBlocked` boolean flag (default: `false`) and an optional `blockReason` field. When `isBlocked` is `true`, the wallet is denied service at every interaction point.

### Eligibility Checks

**API Layer (pre-request validation)**:

1. **Registration**: `registerWallet()` checks `isBlocked` before updating the wallet record. Blocked wallets receive HTTP 403 with `BlockedWalletError`.
2. **Sponsorship request**: `validateWalletNotBlocked()` is called before creating a sponsorship request. Blocked wallets receive HTTP 403.
3. **Active request check**: `validateNoPendingRequest()` rejects wallets that already have a sponsorship in `pending`, `approved`, or `relayed` status (HTTP 400).
4. **Completed check**: Wallets with a `completed` sponsorship are rejected with "wallet has already been sponsored" (HTTP 400).

**Worker Layer (processing-time validation)**:

1. The processor acquires a row-level lock on the sponsorship request via `SELECT FOR UPDATE SKIP LOCKED`
2. For requests in `pending` status, it checks `wallet.isBlocked`
3. If blocked, the request is transitioned to `rejected` status with `eligibilityReason: "Wallet is blocked"`
4. The request is never relayed on-chain

### Partial Unique Index

A partial unique index enforces at the database level that only one non-terminal sponsorship request can exist per wallet:

```sql
CREATE UNIQUE INDEX "sponsorship_requests_wallet_non_terminal"
ON "sponsorship_requests" ("walletId")
WHERE status IN ('pending', 'approved', 'relayed');
```

This prevents race conditions where concurrent API requests could create multiple active sponsorships for the same wallet, even if the application-level check passes.

### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Abuse from known-bad wallets | `isBlocked` flag checked at API and worker layers | HTTP 403 at API; status transition to `rejected` at worker |
| Double-sponsorship via concurrent requests | Partial unique index on non-terminal statuses | Database constraint violation prevents duplicate active requests |
| Re-sponsorship of already-sponsored wallets | `validateNoPendingRequest()` checks for `completed` status | HTTP 400 "wallet has already been sponsored" |

## Trust Boundaries

The ArcPass system has four trust boundaries between its components. Each boundary defines what data crosses it, how it is transported, and what validation occurs.

### Client → API

| Aspect | Detail |
|--------|--------|
| Transport | HTTPS (TLS-terminated at reverse proxy or load balancer) |
| Validation | JSON Schema with `additionalProperties: false`; wallet address regex `^0x[0-9a-fA-F]{40}$`; Content-Type enforcement; rate limiting; replay protection |
| Data crossing | Wallet addresses, sponsorship request parameters, pagination cursors |

The API treats all client input as untrusted. Every field is validated against a strict JSON Schema before reaching business logic. The `additionalProperties: false` setting rejects payloads containing unexpected fields.

### API → Database

| Aspect | Detail |
|--------|--------|
| Transport | PostgreSQL wire protocol over internal Docker network (service-name resolution) |
| Validation | Prisma ORM parameterized queries (SQL injection prevention); schema-level constraints (unique indexes, foreign keys, enum types) |
| Data crossing | Normalized wallet addresses, sponsorship request records, rate limit counters, status transitions |

The API never constructs raw SQL strings. All database interactions use Prisma's query builder, which parameterizes inputs. Database-level constraints (unique indexes, foreign keys, enums) provide a second layer of validation.

### Database → Worker

| Aspect | Detail |
|--------|--------|
| Transport | PostgreSQL wire protocol over internal Docker network |
| Validation | Row-level locking (`SELECT FOR UPDATE SKIP LOCKED`) ensures exclusive processing; status checks prevent re-processing; wallet eligibility re-validated before relay |
| Data crossing | Sponsorship request records, wallet records, relay transaction state |

The worker re-validates eligibility (wallet blocking, status correctness) within the database transaction. This prevents TOCTOU (time-of-check-time-of-use) vulnerabilities where a wallet could be blocked between API acceptance and worker processing.

### Worker → Blockchain

| Aspect | Detail |
|--------|--------|
| Transport | JSON-RPC over HTTPS to the Arc Network RPC endpoint |
| Validation | Chain ID verification at startup (terminates on mismatch); transaction receipt confirmation with configurable confirmation blocks; `AlreadySponsored` guard on-chain prevents duplicate transfers |
| Data crossing | Signed transactions (sponsorTransfer calls), transaction receipts, block numbers, event logs |

The worker verifies the chain ID matches the configured value before processing any requests. If the RPC endpoint returns a different chain ID, the worker terminates immediately (`process.exit(1)`). On-chain, the `SponsorVault` contract enforces per-transaction limits and the `AlreadySponsored` guard prevents double-spending.

## Hardening Measures

### Security Headers

All HTTP responses include the following security headers, applied via the `security-headers` Fastify plugin (`onSend` hook):

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing attacks |
| `X-Frame-Options` | `DENY` | Prevents clickjacking via iframe embedding |
| `X-XSS-Protection` | `0` | Disables legacy XSS filter (modern CSP is preferred) |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | Restricts resource loading and framing |
| `Cache-Control` | `no-store` | Prevents caching of API responses containing sensitive data |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS (set conditionally when served over HTTPS) |

The `X-Powered-By` header is explicitly removed from all responses to avoid leaking server technology information.

#### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| MIME-type confusion attacks | `X-Content-Type-Options: nosniff` | Browser respects declared Content-Type |
| Clickjacking | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` | Page cannot be embedded in frames |
| Response caching of sensitive data | `Cache-Control: no-store` | Proxies and browsers do not cache responses |
| Server fingerprinting | Removal of `X-Powered-By` | No technology stack information in response headers |

### Frozen Configuration Objects

Both the API and worker configuration loaders return frozen objects via `Object.freeze()`:

- **API**: `config` object in `apps/api/src/lib/config.js` — contains `port`, `logLevel`, `databaseUrl`, `corsAllowedOrigins`, `rateLimitIpMax`, `rateLimitWindowMs`, `rateLimitBlockDurationMs`, `rateLimitWalletMax`
- **Worker**: `WorkerConfig` object in `apps/worker/src/config.ts` — contains all runtime parameters including `chainRpcUrl`, `sponsorPrivateKey`, `pollIntervalMs`, `batchSize`, `shutdownTimeoutMs`

#### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Accidental or malicious runtime config mutation | `Object.freeze()` on config objects | `TypeError` thrown on any attempt to modify config properties (in strict mode) |

### Correlation IDs

The `correlation-id` Fastify plugin generates or validates a request correlation ID for every incoming request:

- **Header**: `X-Request-ID`
- **Validation**: 1–128 printable ASCII characters (code points 0x20–0x7E)
- **Generation**: If the incoming header is missing or invalid, a UUID v4 is generated via `crypto.randomUUID()`
- **Propagation**: The correlation ID is attached to `request.correlationId` and included in all response headers

#### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Header injection via oversized or non-printable correlation IDs | 128-character maximum length; printable ASCII validation | Invalid headers are discarded and replaced with a generated UUID |
| Request tracing gaps | Automatic generation when header is absent | Every response includes `X-Request-ID` for end-to-end tracing |

### Graceful Shutdown

The worker implements graceful shutdown with a bounded timeout:

- **Signals**: `SIGTERM` and `SIGINT` trigger the shutdown sequence
- **Timeout**: 10,000 ms (configurable via `SHUTDOWN_TIMEOUT_MS`)
- **Behavior**: The poller stops accepting new work, in-progress jobs are allowed to complete within the timeout window
- **Force exit**: If the poller does not stop within the timeout, the process exits with code 1 so the container orchestrator can restart it

#### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Data corruption from abrupt process termination | Graceful drain with bounded timeout allows in-flight transactions to complete | Clean shutdown logs; no orphaned database locks |
| Zombie processes that never terminate | Force exit after timeout with `process.exit(1)` | Container orchestrator detects exit and restarts the service |

### JSON Schema Strictness

All API request validation uses JSON Schema with `additionalProperties: false`:

- Unexpected fields in request bodies are rejected with HTTP 400
- Schema validation errors are translated into human-readable field-level messages
- The strict schema prevents mass-assignment vulnerabilities where unexpected fields could influence business logic

#### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Mass-assignment / parameter pollution | `additionalProperties: false` rejects unknown fields | HTTP 400 with field-level validation error messages |
| Malformed input reaching business logic | Schema validation runs before route handlers | Invalid requests never reach service layer |

### Row-Level Locking

The worker uses PostgreSQL row-level locking to ensure exclusive processing of sponsorship requests:

```sql
SELECT id, status, "walletId" FROM "sponsorship_requests"
WHERE id = $1
FOR UPDATE SKIP LOCKED
```

- **`FOR UPDATE`**: Acquires an exclusive lock on the selected row
- **`SKIP LOCKED`**: If the row is already locked by another transaction, it is skipped rather than blocking
- **Scope**: The lock is held for the duration of the database transaction (including relay execution)
- **Timeout**: Configurable via `LOCK_TIMEOUT_MS` (default: 30,000 ms)

#### Threat Mitigation

| Threat | Mechanism | Observable Behavior |
|--------|-----------|-------------------|
| Double-processing of the same request by concurrent workers | `SELECT FOR UPDATE SKIP LOCKED` ensures only one worker processes each request | Second worker skips the locked row and processes other pending requests |
| Deadlocks between competing transactions | `SKIP LOCKED` avoids blocking; transaction timeout prevents indefinite waits | Skipped requests are picked up in the next poll cycle |

## Related Documentation

- [API Architecture](../backend/api-architecture.md) — Plugin registration order and error handling
- [Runtime Flow](../architecture/runtime-flow.md) — Worker processing sequence diagrams
- [Database](../backend/database.md) — Schema, indexes, and status transitions
- [Docker Architecture](../infrastructure/docker-architecture.md) — Network isolation and service boundaries
