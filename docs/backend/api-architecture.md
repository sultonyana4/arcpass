---
title: "API Architecture"
description: "Fastify 5.x plugin architecture, JSON Schema validation, error handling strategy, and service layer pattern."
---

# API Architecture

The ArcPass API is built on [Fastify 5.x](https://fastify.dev/) using a plugin-based architecture. Each cross-cutting concern (CORS, security headers, request tracing, validation, error handling) is encapsulated as a Fastify plugin registered in a strict order. Business logic lives in a service layer, keeping route handlers thin.

## Plugin Registration Sequence

Plugins are registered in a specific order in `apps/api/src/server.js`. Each plugin uses `fastify-plugin` (`fp`) to share its hooks across the encapsulation boundary.

| Order | Plugin | Purpose |
|-------|--------|---------|
| 1 | CORS | Enforces a strict origin allowlist and handles OPTIONS preflight responses before any other processing occurs. |
| 2 | Security Headers | Attaches security response headers (X-Content-Type-Options, X-Frame-Options, Content-Security-Policy, Cache-Control) and removes X-Powered-By from every response. |
| 3 | Correlation ID | Reads or generates an `X-Request-ID` header (1–128 printable ASCII characters) and attaches it to both the request object and the response. |
| 4 | Content-Type Check | Validates that POST requests include a `Content-Type: application/json` header, rejecting non-JSON payloads with HTTP 400. |
| 5 | Replay Protection | Prevents duplicate `POST /sponsorship/request` submissions from the same wallet+IP within a 5-second deduplication window. |
| 6 | Error Handler | Centralizes error mapping — translates application errors, JSON parse failures, and schema validation errors into structured `{ error, statusCode }` responses. |
| 7 | Routes | Registers business endpoint handlers (`/health`, `/wallets`, `/sponsorship`, `/relay`) with JSON Schema validation on each route. |
| 8 | Not-Found Handler | Catches unmatched requests after all routes are registered, returning 404 for unknown paths and 405 (with `Allow` header) for known paths with unsupported methods. |

<Note>The not-found handler must be registered **after** routes so it can inspect the full route table to distinguish 404 from 405 responses.</Note>

## JSON Schema Validation

Every route defines a JSON Schema for its request parameters (body, params, querystring). Fastify compiles these schemas at startup using Ajv for zero-overhead validation at runtime.

### Key conventions

- **`additionalProperties: false`** on every schema object — unknown fields are rejected immediately, preventing data leakage and typo-based bugs.
- **Field-level error messages** — the error handler translates raw Ajv validation keywords into human-readable messages:

| Ajv Keyword | Translated Message |
|-------------|-------------------|
| `required` | `{field} is required` |
| `type` | `{field} must be of type {expected}` |
| `pattern` | `{field} has an invalid format` |
| `maxLength` | `{field} exceeds maximum length` |
| `minLength` | `{field} is too short` |
| `format` | `{field} has an invalid format` |
| `additionalProperties` | `Unknown property: {property}` |
| `enum` | `{field} has an invalid value` |
| `minimum` / `maximum` | `{field} is out of range` |

Multiple validation failures are joined with semicolons into a single error string.

### Example schema

```javascript
const registerSchema = {
  body: {
    type: 'object',
    required: ['walletAddress'],
    properties: {
      walletAddress: {
        type: 'string',
        pattern: '^0x[0-9a-fA-F]{40}$',
        maxLength: 42,
      },
    },
    additionalProperties: false,
  },
}
```

A request with `{ "walletAddress": "invalid", "extra": true }` produces:

```json
{ "error": "walletAddress has an invalid format; Unknown property: extra", "statusCode": 400 }
```

## Error Handling Strategy

All errors flow through the centralized error handler plugin (`plugins/error-handler.js`). The handler maps known error classes to HTTP status codes and produces a consistent response shape.

### Custom Error Classes

Defined in `apps/api/src/lib/errors.js`:

| Error Class | HTTP Status | When Thrown |
|-------------|-------------|------------|
| `ValidationError` | 400 | Input fails business validation (e.g., invalid wallet address format after schema passes) |
| `BlockedWalletError` | 403 | Wallet has `isBlocked: true` in the database |
| `WalletNotFoundError` | 404 | Wallet address does not exist in the registry |
| `SponsorshipNotFoundError` | 404 | Sponsorship request ID or relay transaction hash not found |
| `RateLimitError` | 429 | IP or wallet rate limit exceeded (includes `Retry-After` header) |
| `InvalidStatusTransitionError` | 400 | Attempted an invalid state transition on a sponsorship request |

### Additional error mappings

| Condition | HTTP Status | Message |
|-----------|-------------|---------|
| JSON parse failure | 400 | `Invalid JSON in request body` |
| Schema validation failure | 400 | Field-level message (see above) |
| Unknown/unhandled error | 500 | `Internal server error` |

### Structured Response Shape

Every error response follows this structure:

```json
{
  "error": "Human-readable error message",
  "statusCode": 400
}
```

- **Production mode**: Only `error` and `statusCode` fields are returned. No stack traces, internal paths, or error class names are exposed.
- **Development mode**: An additional `errorName` field is included for debugging (e.g., `"errorName": "ValidationError"`).

<Warning>The `RateLimitError` response also includes a `Retry-After` response header indicating how many seconds the client should wait before retrying.</Warning>

## Service Layer Pattern

The API follows a three-layer architecture that separates concerns:

```
routes/          →  services/          →  lib/
(HTTP handling)     (business logic)      (utilities & validation)
```

| Layer | Directory | Responsibility |
|-------|-----------|---------------|
| **Routes** | `apps/api/src/routes/` | Define HTTP endpoints, attach JSON Schema validation, extract request data, call services, format responses. |
| **Services** | `apps/api/src/services/` | Contain business logic, orchestrate database operations via Prisma, enforce domain rules, throw typed errors. |
| **Lib** | `apps/api/src/lib/` | Provide pure utilities — input normalization, format validation, configuration, and error class definitions. |

### Delegation Flow Example

The wallet registration endpoint demonstrates the full delegation chain:

```
POST /wallets/register
    │
    ▼
routes/wallets.js          ← Extracts walletAddress from validated body
    │                         Calls registerWallet(walletAddress)
    │                         Formats response, sets status code (201 or 200)
    ▼
services/wallet.service.js ← Calls normalizeWalletAddress(rawAddress)
    │                         Queries database for existing wallet
    │                         Creates or updates wallet record
    │                         Throws BlockedWalletError if wallet is blocked
    ▼
lib/wallet-validation.js   ← Trims and lowercases the address
                              Validates against /^0x[0-9a-fA-F]{40}$/
                              Throws ValidationError if format is invalid
```

**Route handler** (`routes/wallets.js`):

```javascript
fastify.post('/register', { schema: registerSchema }, async (request, reply) => {
  const { walletAddress } = request.body
  const { wallet, isNew } = await registerWallet(walletAddress)
  const statusCode = isNew ? 201 : 200
  return reply.status(statusCode).send(formatWalletResponse(wallet))
})
```

**Service** (`services/wallet.service.js`):

```javascript
export async function registerWallet(rawAddress) {
  const normalized = normalizeWalletAddress(rawAddress)

  const existing = await prisma.wallet.findUnique({
    where: { walletAddress: normalized },
  })

  if (!existing) {
    const wallet = await prisma.wallet.create({
      data: { walletAddress: normalized },
    })
    return { wallet, isNew: true }
  }

  if (existing.isBlocked) {
    throw new BlockedWalletError('Wallet is blocked')
  }

  const wallet = await prisma.wallet.update({
    where: { walletAddress: normalized },
    data: { lastSeenAt: new Date(), sponsorshipCount: { increment: 1 } },
  })

  return { wallet, isNew: false }
}
```

**Lib utility** (`lib/wallet-validation.js`):

```javascript
export function normalizeWalletAddress(address) {
  if (typeof address !== 'string') {
    throw new ValidationError('Wallet address must be a string')
  }

  const trimmed = address.trim()

  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new ValidationError(
      'Invalid wallet address format. Expected 0x followed by 40 hexadecimal characters'
    )
  }

  return trimmed.toLowerCase()
}
```

This pattern ensures route handlers remain thin (HTTP concerns only), services own the business rules, and lib utilities are reusable across multiple services.

## Related Documentation

- [Database Architecture](database.md)
- [API Endpoints Reference](../api/endpoints.md)
- [Security Model](../security/security-model.md)
- [System Overview](../architecture/system-overview.md)
