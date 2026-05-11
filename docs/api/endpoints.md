---
title: "API Endpoints Reference"
description: "Complete reference for all ArcPass API endpoints including request schemas, response formats, and validation rules."
---

# API Endpoints Reference

This document provides a complete reference for all public ArcPass API endpoints. Each endpoint includes the HTTP method, full path, purpose, request/response schemas, validation rules, and example payloads.

## Base URL

All endpoints are served from the Fastify API service. In local development the base URL is:

```
http://localhost:4000
```

When accessed through the Next.js frontend proxy, the base path is `/api/backend`.

---

## Error Response Structure

All error responses follow a standardized structure:

```json
{
  "error": "Human-readable error message",
  "statusCode": 400
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | Human-readable description of the error |
| `statusCode` | `number` | HTTP status code (matches the response status) |

### HTTP Status Codes

| Code | Condition |
|------|-----------|
| 400 | Validation error (invalid field format, missing required field, unknown property) or invalid JSON body |
| 403 | Blocked wallet attempting an operation |
| 404 | Resource not found (wallet, sponsorship request, or relay transaction) |
| 429 | Rate limit exceeded or duplicate request detected (includes `Retry-After` header) |
| 500 | Internal server error (unexpected failure) |

---

## Validation Rules

The following validation rules apply across all endpoints:

| Rule | Format | Details |
|------|--------|---------|
| Wallet address | `^0x[0-9a-fA-F]{40}$` | Exactly 42 characters, checksummed or lowercase hex |
| UUID | RFC 4122 v4 | Used for all `id` path parameters and pagination cursors |
| Transaction hash | String, max 1024 characters | Minimum 1 character |
| Pagination cursor | UUID format, max 36 characters | References a sponsorship request ID |
| Pagination limit | Integer, 1–100 | Default: 50 |

All request bodies enforce `additionalProperties: false` — unknown fields are rejected with a 400 error.

---

## Endpoints

### GET /health

**Purpose**: Returns the service health status and uptime.

#### Request

| Component | Details |
|-----------|---------|
| Method | `GET` |
| Path | `/health` |
| Headers | None required |
| Path params | None |
| Query params | None |
| Body | None |

<Note>The health endpoint is excluded from IP rate limiting.</Note>

#### Success Response

**Status**: `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` |
| `uptime` | `number` | Server uptime in seconds (integer) |

#### Example

**Request**:

```bash
curl http://localhost:4000/health
```

**Response**:

```json
{
  "status": "ok",
  "uptime": 3842
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 500 | Internal server error |

---

### POST /wallets/register

**Purpose**: Registers a new wallet address or updates the last-seen timestamp for an existing wallet.

#### Request

| Component | Details |
|-----------|---------|
| Method | `POST` |
| Path | `/wallets/register` |
| Headers | `Content-Type: application/json` |
| Path params | None |
| Query params | None |
| Body | JSON object (see schema below) |

**Body Schema**:

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `walletAddress` | `string` | Yes | Pattern: `^0x[0-9a-fA-F]{40}$`, max 42 chars |

#### Success Response

**Status**: `201 Created` (new wallet) or `200 OK` (existing wallet)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID of the wallet record |
| `walletAddress` | `string` | Normalized wallet address |
| `firstSeenAt` | `string` | ISO 8601 timestamp of first registration |
| `lastSeenAt` | `string` | ISO 8601 timestamp of most recent activity |
| `sponsorshipCount` | `number` | Total sponsorship request count |
| `isBlocked` | `boolean` | Whether the wallet is blocked |

#### Example

**Request**:

```bash
curl -X POST http://localhost:4000/wallets/register \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28"}'
```

**Response** (201 Created):

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "walletAddress": "0x742d35cc6634c0532925a3b844bc9e7595f2bd28",
  "firstSeenAt": "2025-01-15T10:30:00.000Z",
  "lastSeenAt": "2025-01-15T10:30:00.000Z",
  "sponsorshipCount": 0,
  "isBlocked": false
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Invalid wallet address format, missing `walletAddress` field, or unknown property in body |
| 403 | Wallet is blocked |
| 429 | IP rate limit exceeded |
| 500 | Internal server error |

---

### GET /wallets/:address

**Purpose**: Looks up a wallet by its address. Read-only — does not modify any fields.

#### Request

| Component | Details |
|-----------|---------|
| Method | `GET` |
| Path | `/wallets/:address` |
| Headers | None required |
| Path params | `address` — wallet address (pattern: `^0x[0-9a-fA-F]{40}$`, max 42 chars) |
| Query params | None |
| Body | None |

#### Success Response

**Status**: `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID of the wallet record |
| `walletAddress` | `string` | Normalized wallet address |
| `firstSeenAt` | `string` | ISO 8601 timestamp of first registration |
| `lastSeenAt` | `string` | ISO 8601 timestamp of most recent activity |
| `sponsorshipCount` | `number` | Total sponsorship request count |
| `isBlocked` | `boolean` | Whether the wallet is blocked |

#### Example

**Request**:

```bash
curl http://localhost:4000/wallets/0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28
```

**Response**:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "walletAddress": "0x742d35cc6634c0532925a3b844bc9e7595f2bd28",
  "firstSeenAt": "2025-01-15T10:30:00.000Z",
  "lastSeenAt": "2025-01-15T12:45:00.000Z",
  "sponsorshipCount": 2,
  "isBlocked": false
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Invalid wallet address format |
| 404 | Wallet not found |
| 429 | IP rate limit exceeded |
| 500 | Internal server error |

---

### GET /wallets/:address/history

**Purpose**: Retrieves paginated sponsorship request history for a wallet using cursor-based pagination.

#### Request

| Component | Details |
|-----------|---------|
| Method | `GET` |
| Path | `/wallets/:address/history` |
| Headers | None required |
| Path params | `address` — wallet address (pattern: `^0x[0-9a-fA-F]{40}$`, max 42 chars) |
| Query params | See below |
| Body | None |

**Query Parameters**:

| Param | Type | Required | Validation | Default |
|-------|------|----------|------------|---------|
| `cursor` | `string` | No | UUID format, max 36 chars | None |
| `limit` | `integer` | No | Min: 1, Max: 100 | 50 |

#### Success Response

**Status**: `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `data` | `array` | Array of sponsorship request objects |
| `data[].id` | `string` | UUID of the sponsorship request |
| `data[].walletId` | `string` | UUID of the associated wallet |
| `data[].status` | `string` | One of: `pending`, `approved`, `rejected`, `relayed`, `completed`, `failed` |
| `data[].eligibilityReason` | `string\|null` | Reason for eligibility decision |
| `data[].requestedAt` | `string` | ISO 8601 timestamp |
| `data[].approvedAt` | `string\|null` | ISO 8601 timestamp |
| `data[].rejectedAt` | `string\|null` | ISO 8601 timestamp |
| `data[].completedAt` | `string\|null` | ISO 8601 timestamp |
| `data[].failedAt` | `string\|null` | ISO 8601 timestamp |
| `data[].ipAddress` | `string\|null` | Requester IP address |
| `data[].userAgent` | `string\|null` | Requester user agent |
| `pagination` | `object` | Pagination metadata |
| `pagination.cursor` | `string\|null` | Cursor for the next page (null if no more pages) |
| `pagination.hasMore` | `boolean` | Whether more records exist |
| `pagination.limit` | `number` | The applied page size |

#### Example

**Request**:

```bash
curl "http://localhost:4000/wallets/0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28/history?limit=2"
```

**Response**:

```json
{
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "walletId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "status": "completed",
      "eligibilityReason": null,
      "requestedAt": "2025-01-15T12:00:00.000Z",
      "approvedAt": "2025-01-15T12:00:01.000Z",
      "rejectedAt": null,
      "completedAt": "2025-01-15T12:00:15.000Z",
      "failedAt": null,
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0"
    },
    {
      "id": "b3d7e9a1-2c4f-4b8e-9d1a-6f3c5e7a9b2d",
      "walletId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "status": "pending",
      "eligibilityReason": null,
      "requestedAt": "2025-01-14T08:30:00.000Z",
      "approvedAt": null,
      "rejectedAt": null,
      "completedAt": null,
      "failedAt": null,
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0"
    }
  ],
  "pagination": {
    "cursor": "b3d7e9a1-2c4f-4b8e-9d1a-6f3c5e7a9b2d",
    "hasMore": true,
    "limit": 2
  }
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Invalid wallet address format, invalid cursor format, or limit out of range |
| 404 | Wallet not found |
| 429 | IP rate limit exceeded |
| 500 | Internal server error |

---

### POST /sponsorship/request

**Purpose**: Creates a new sponsorship request for an eligible wallet. Validates wallet existence, blocked status, and ensures no pending request already exists.

#### Request

| Component | Details |
|-----------|---------|
| Method | `POST` |
| Path | `/sponsorship/request` |
| Headers | `Content-Type: application/json` |
| Path params | None |
| Query params | None |
| Body | JSON object (see schema below) |

**Body Schema**:

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `walletAddress` | `string` | Yes | Pattern: `^0x[0-9a-fA-F]{40}$`, max 42 chars |

<Warning>This endpoint has replay protection. Duplicate requests from the same wallet address and IP within a 5-second window are rejected with HTTP 429.</Warning>

#### Success Response

**Status**: `201 Created`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID of the created sponsorship request |
| `walletId` | `string` | UUID of the associated wallet |
| `status` | `string` | Always `"pending"` for new requests |
| `eligibilityReason` | `string\|null` | Always `null` on creation |
| `requestedAt` | `string` | ISO 8601 timestamp |
| `approvedAt` | `string\|null` | Always `null` on creation |
| `rejectedAt` | `string\|null` | Always `null` on creation |
| `completedAt` | `string\|null` | Always `null` on creation |
| `failedAt` | `string\|null` | Always `null` on creation |
| `ipAddress` | `string\|null` | Requester IP address |
| `userAgent` | `string\|null` | Requester user agent |

#### Example

**Request**:

```bash
curl -X POST http://localhost:4000/sponsorship/request \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28"}'
```

**Response** (201 Created):

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "walletId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending",
  "eligibilityReason": null,
  "requestedAt": "2025-01-15T14:00:00.000Z",
  "approvedAt": null,
  "rejectedAt": null,
  "completedAt": null,
  "failedAt": null,
  "ipAddress": "192.168.1.100",
  "userAgent": "curl/8.1.2"
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Invalid wallet address format, missing `walletAddress` field, or wallet already has a pending request |
| 403 | Wallet is blocked |
| 404 | Wallet not found (must register first via POST /wallets/register) |
| 429 | IP rate limit exceeded, wallet rate limit exceeded, or duplicate request within 5-second replay window |
| 500 | Internal server error |

---

### GET /sponsorship/:id

**Purpose**: Retrieves a sponsorship request by its UUID, including the associated wallet and relay transaction history.

#### Request

| Component | Details |
|-----------|---------|
| Method | `GET` |
| Path | `/sponsorship/:id` |
| Headers | None required |
| Path params | `id` — sponsorship request UUID |
| Query params | None |
| Body | None |

#### Success Response

**Status**: `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID of the sponsorship request |
| `walletId` | `string` | UUID of the associated wallet |
| `status` | `string` | One of: `pending`, `approved`, `rejected`, `relayed`, `completed`, `failed` |
| `eligibilityReason` | `string\|null` | Reason for eligibility decision |
| `requestedAt` | `string` | ISO 8601 timestamp |
| `approvedAt` | `string\|null` | ISO 8601 timestamp |
| `rejectedAt` | `string\|null` | ISO 8601 timestamp |
| `completedAt` | `string\|null` | ISO 8601 timestamp |
| `failedAt` | `string\|null` | ISO 8601 timestamp |
| `ipAddress` | `string\|null` | Requester IP address |
| `userAgent` | `string\|null` | Requester user agent |
| `wallet` | `object` | Associated wallet record |
| `wallet.id` | `string` | UUID of the wallet |
| `wallet.walletAddress` | `string` | Normalized wallet address |
| `wallet.firstSeenAt` | `string` | ISO 8601 timestamp |
| `wallet.lastSeenAt` | `string` | ISO 8601 timestamp |
| `wallet.sponsorshipCount` | `number` | Total sponsorship count |
| `wallet.isBlocked` | `boolean` | Whether the wallet is blocked |
| `relayTransactions` | `array` | Array of relay transaction records (ordered by attempt) |
| `relayTransactions[].id` | `string` | UUID of the relay transaction |
| `relayTransactions[].status` | `string` | One of: `queued`, `submitted`, `confirmed`, `failed` |
| `relayTransactions[].relayAttempt` | `number` | Attempt number (starting at 1) |
| `relayTransactions[].transactionHash` | `string\|null` | On-chain transaction hash |
| `relayTransactions[].submittedAt` | `string\|null` | ISO 8601 timestamp |
| `relayTransactions[].confirmedAt` | `string\|null` | ISO 8601 timestamp |
| `relayTransactions[].failedAt` | `string\|null` | ISO 8601 timestamp |
| `relayTransactions[].failureReason` | `string\|null` | Reason for failure |

#### Example

**Request**:

```bash
curl http://localhost:4000/sponsorship/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Response**:

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "walletId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "eligibilityReason": null,
  "requestedAt": "2025-01-15T14:00:00.000Z",
  "approvedAt": "2025-01-15T14:00:01.000Z",
  "rejectedAt": null,
  "completedAt": "2025-01-15T14:00:15.000Z",
  "failedAt": null,
  "ipAddress": "192.168.1.100",
  "userAgent": "curl/8.1.2",
  "wallet": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "walletAddress": "0x742d35cc6634c0532925a3b844bc9e7595f2bd28",
    "firstSeenAt": "2025-01-15T10:30:00.000Z",
    "lastSeenAt": "2025-01-15T14:00:00.000Z",
    "sponsorshipCount": 2,
    "isBlocked": false
  },
  "relayTransactions": [
    {
      "id": "c8d9e0f1-2a3b-4c5d-6e7f-8a9b0c1d2e3f",
      "status": "confirmed",
      "relayAttempt": 1,
      "transactionHash": "0xabc123def456789012345678901234567890123456789012345678901234abcd",
      "submittedAt": "2025-01-15T14:00:02.000Z",
      "confirmedAt": "2025-01-15T14:00:15.000Z",
      "failedAt": null,
      "failureReason": null
    }
  ]
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Invalid UUID format for `id` parameter |
| 404 | Sponsorship request not found |
| 429 | IP rate limit exceeded |
| 500 | Internal server error |

---

### GET /sponsorship/tx/:hash

**Purpose**: Looks up a relay transaction by its on-chain transaction hash, returning both the relay transaction and its associated sponsorship request.

#### Request

| Component | Details |
|-----------|---------|
| Method | `GET` |
| Path | `/sponsorship/tx/:hash` |
| Headers | None required |
| Path params | `hash` — transaction hash (string, min 1 char, max 1024 chars) |
| Query params | None |
| Body | None |

#### Success Response

**Status**: `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `sponsorshipRequest` | `object` | The associated sponsorship request |
| `sponsorshipRequest.id` | `string` | UUID of the sponsorship request |
| `sponsorshipRequest.walletId` | `string` | UUID of the associated wallet |
| `sponsorshipRequest.status` | `string` | One of: `pending`, `approved`, `rejected`, `relayed`, `completed`, `failed` |
| `sponsorshipRequest.eligibilityReason` | `string\|null` | Reason for eligibility decision |
| `sponsorshipRequest.requestedAt` | `string` | ISO 8601 timestamp |
| `sponsorshipRequest.approvedAt` | `string\|null` | ISO 8601 timestamp |
| `sponsorshipRequest.rejectedAt` | `string\|null` | ISO 8601 timestamp |
| `sponsorshipRequest.completedAt` | `string\|null` | ISO 8601 timestamp |
| `sponsorshipRequest.failedAt` | `string\|null` | ISO 8601 timestamp |
| `sponsorshipRequest.ipAddress` | `string\|null` | Requester IP address |
| `sponsorshipRequest.userAgent` | `string\|null` | Requester user agent |
| `relayTransaction` | `object` | The relay transaction record |
| `relayTransaction.id` | `string` | UUID of the relay transaction |
| `relayTransaction.sponsorshipRequestId` | `string` | UUID of the parent sponsorship request |
| `relayTransaction.transactionHash` | `string` | On-chain transaction hash |
| `relayTransaction.status` | `string` | One of: `queued`, `submitted`, `confirmed`, `failed` |
| `relayTransaction.relayAttempt` | `number` | Attempt number |
| `relayTransaction.submittedAt` | `string\|null` | ISO 8601 timestamp |
| `relayTransaction.confirmedAt` | `string\|null` | ISO 8601 timestamp |
| `relayTransaction.failedAt` | `string\|null` | ISO 8601 timestamp |
| `relayTransaction.failureReason` | `string\|null` | Reason for failure |

#### Example

**Request**:

```bash
curl http://localhost:4000/sponsorship/tx/0xabc123def456789012345678901234567890123456789012345678901234abcd
```

**Response**:

```json
{
  "sponsorshipRequest": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "walletId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "completed",
    "eligibilityReason": null,
    "requestedAt": "2025-01-15T14:00:00.000Z",
    "approvedAt": "2025-01-15T14:00:01.000Z",
    "rejectedAt": null,
    "completedAt": "2025-01-15T14:00:15.000Z",
    "failedAt": null,
    "ipAddress": "192.168.1.100",
    "userAgent": "curl/8.1.2"
  },
  "relayTransaction": {
    "id": "c8d9e0f1-2a3b-4c5d-6e7f-8a9b0c1d2e3f",
    "sponsorshipRequestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "transactionHash": "0xabc123def456789012345678901234567890123456789012345678901234abcd",
    "status": "confirmed",
    "relayAttempt": 1,
    "submittedAt": "2025-01-15T14:00:02.000Z",
    "confirmedAt": "2025-01-15T14:00:15.000Z",
    "failedAt": null,
    "failureReason": null
  }
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Transaction hash is empty or exceeds 1024 characters |
| 404 | Transaction not found |
| 429 | IP rate limit exceeded |
| 500 | Internal server error |

---

### GET /relay/:id

**Purpose**: Retrieves a relay transaction by its UUID.

#### Request

| Component | Details |
|-----------|---------|
| Method | `GET` |
| Path | `/relay/:id` |
| Headers | None required |
| Path params | `id` — relay transaction UUID |
| Query params | None |
| Body | None |

#### Success Response

**Status**: `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID of the relay transaction |
| `sponsorshipRequestId` | `string` | UUID of the parent sponsorship request |
| `status` | `string` | One of: `queued`, `submitted`, `confirmed`, `failed` |
| `relayAttempt` | `number` | Attempt number (starting at 1) |
| `transactionHash` | `string\|null` | On-chain transaction hash |
| `submittedAt` | `string\|null` | ISO 8601 timestamp when submitted to chain |
| `confirmedAt` | `string\|null` | ISO 8601 timestamp when confirmed on chain |
| `failedAt` | `string\|null` | ISO 8601 timestamp when failure occurred |
| `failureReason` | `string\|null` | Human-readable failure description |

#### Example

**Request**:

```bash
curl http://localhost:4000/relay/c8d9e0f1-2a3b-4c5d-6e7f-8a9b0c1d2e3f
```

**Response**:

```json
{
  "id": "c8d9e0f1-2a3b-4c5d-6e7f-8a9b0c1d2e3f",
  "sponsorshipRequestId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "confirmed",
  "relayAttempt": 1,
  "transactionHash": "0xabc123def456789012345678901234567890123456789012345678901234abcd",
  "submittedAt": "2025-01-15T14:00:02.000Z",
  "confirmedAt": "2025-01-15T14:00:15.000Z",
  "failedAt": null,
  "failureReason": null
}
```

#### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Invalid UUID format for `id` parameter |
| 404 | Relay transaction not found |
| 429 | IP rate limit exceeded |
| 500 | Internal server error |

---

## Rate Limiting

All endpoints (except `GET /health`) are subject to IP-based rate limiting:

- **IP rate limit**: 10 requests per sliding window (default window: 3,600,000 ms / 1 hour)
- **Block duration**: 900,000 ms (15 minutes) after exceeding the limit
- **Wallet rate limit** (POST /sponsorship/request only): 5 requests per window

When rate limited, the response includes a `Retry-After` header indicating the number of seconds to wait before retrying.

## Replay Protection

The `POST /sponsorship/request` endpoint has a 5-second deduplication window. Duplicate requests from the same wallet address and client IP within this window are rejected with:

```json
{
  "error": "Duplicate request detected. Please wait before retrying.",
  "statusCode": 429
}
```

The `Retry-After` header indicates the remaining seconds in the deduplication window.

---

## Related Documentation

- [API Architecture](../backend/api-architecture.md) — Plugin system, validation, and error handling details
- [Security Model](../security/security-model.md) — Rate limiting, replay protection, and trust boundaries
- [Database](../backend/database.md) — Data models and status transitions
