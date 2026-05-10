# Implementation Plan: Wallet Registry

## Overview

Implement the Wallet Registry REST API within `apps/api`, providing wallet registration (POST /wallets/register) and lookup (GET /wallets/:address) endpoints. The implementation follows the layered architecture defined in the design: validation utilities → service layer → route plugin → error handler. All database access uses the existing Prisma singleton from `@arcpass/shared` and the existing `Wallet` model.

## Tasks

- [x] 1. Create validation utilities and custom error classes
  - [x] 1.1 Create `apps/api/src/lib/wallet-validation.js` with `isValidWalletAddress` and `normalizeWalletAddress` pure functions
    - `isValidWalletAddress(address)`: trims whitespace, tests against `/^0x[0-9a-fA-F]{40}$/`
    - `normalizeWalletAddress(address)`: trims, validates, returns lowercase
    - Throws `ValidationError` if address is invalid
    - _Requirements: 2.1, 2.3, 3.1, 3.4_

  - [x] 1.2 Create `apps/api/src/lib/errors.js` with custom error classes
    - `ValidationError` extends Error
    - `BlockedWalletError` extends Error
    - `WalletNotFoundError` extends Error
    - _Requirements: 8.1, 8.2_

  - [x]* 1.3 Write property tests for address validation (Properties 1 and 3)
    - Create `apps/api/tests/wallet-validation.property.test.js`
    - **Property 1: Normalization to lowercase** — For any valid address with uppercase hex, normalizeWalletAddress returns the lowercase equivalent matching `/^0x[0-9a-f]{40}$/`
    - **Property 3: Invalid address rejection** — For any string not matching `/^0x[0-9a-fA-F]{40}$/` after trimming, isValidWalletAddress returns false and normalizeWalletAddress throws
    - Use fast-check generators for valid addresses (0x + 40 random hex chars) and invalid addresses (wrong length, missing prefix, non-hex chars, empty)
    - Minimum 100 iterations per property
    - **Validates: Requirements 2.1, 2.3, 3.1, 3.4**

- [x] 2. Implement wallet service layer
  - [x] 2.1 Create `apps/api/src/services/wallet.service.js` with `registerWallet` function
    - Import `prisma` from `@arcpass/shared`
    - Import validation utilities from `../lib/wallet-validation.js`
    - Normalize address, then `findUnique` by walletAddress
    - If not found: `create` new record, return `{ wallet, isNew: true }`
    - If found and blocked: throw `BlockedWalletError`
    - If found and not blocked: `update` lastSeenAt and increment sponsorshipCount, return `{ wallet, isNew: false }`
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 4.1, 4.2, 4.3, 6.1, 6.2_

  - [x] 2.2 Add `lookupWallet` function to `apps/api/src/services/wallet.service.js`
    - Normalize address, then `findUnique` by walletAddress
    - If not found: return null
    - If found: return wallet record (read-only, no modifications)
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x]* 2.3 Write property tests for wallet service (Properties 2, 4, 5, 6, 7)
    - Create `apps/api/tests/wallet-service.property.test.js`
    - Mock Prisma client with an in-memory store
    - **Property 2: Case-insensitive registration round-trip** — Register with one casing, lookup with another casing variant returns same record
    - **Property 4: New wallet registration creates correct record** — For any valid address not in store, registerWallet creates record with sponsorshipCount=0, correct timestamps, isNew=true
    - **Property 5: Re-registration increments sponsorship count** — For any existing non-blocked wallet, re-registering increments sponsorshipCount by 1, updates lastSeenAt, preserves firstSeenAt
    - **Property 6: Blocked wallet enforcement preserves state** — For any blocked wallet, registerWallet throws BlockedWalletError and state is unchanged
    - **Property 7: Lookup is read-only** — For any registered wallet, lookupWallet returns the record without modifying any fields
    - Minimum 100 iterations per property
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.6, 2.2, 2.4, 4.1, 4.2, 5.1, 5.3, 5.5**

- [x] 3. Checkpoint - Ensure validation and service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement wallet routes and error handling
  - [x] 4.1 Create `apps/api/src/routes/wallets.js` as a Fastify plugin
    - Export default async function `walletRoutes(fastify, opts)`
    - Define POST `/register` route with JSON schema validation for request body (`walletAddress` required string, no additional properties)
    - Define GET `/:address` route with JSON schema validation for params (`address` required string)
    - Route handlers call wallet service and map results to HTTP responses
    - POST register: return 201 for new wallets, 200 for re-registrations
    - GET lookup: return 200 with wallet record, or throw WalletNotFoundError
    - Response body includes: id, walletAddress, firstSeenAt (ISO 8601), lastSeenAt (ISO 8601), sponsorshipCount, isBlocked
    - _Requirements: 1.3, 1.4, 5.1, 5.4, 7.2, 7.3, 7.5_

  - [x] 4.2 Add custom error handler to the wallet routes plugin or `server.js`
    - Handle Fastify schema validation errors → 400 with standard shape
    - Handle `ValidationError` → 400
    - Handle `BlockedWalletError` → 403
    - Handle `WalletNotFoundError` → 404
    - Handle unexpected errors → 500 with sanitized message (no stack traces, no DB details)
    - All error responses use shape: `{ "error": string, "statusCode": number }`
    - Log full error details via Pino for unexpected errors
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 6.3_

  - [x] 4.3 Register wallet routes in `apps/api/src/server.js`
    - Import wallet routes plugin
    - Register with `app.register(walletRoutes, { prefix: '/wallets' })`
    - Add `prisma.$disconnect()` call in the existing shutdown handler
    - _Requirements: 7.1, 6.4_

  - [x]* 4.4 Write property tests for error response shape (Property 8)
    - Create `apps/api/tests/wallet-routes.property.test.js`
    - **Property 8: Error response shape consistency** — For any request triggering an error (invalid address, blocked wallet, not found), the response body is JSON with exactly two fields: `error` (non-empty string) and `statusCode` (number matching HTTP status)
    - Test across all error categories: 400, 403, 404
    - Use Fastify's `inject()` for HTTP-level testing without starting a server
    - Minimum 100 iterations per property
    - **Validates: Requirements 8.1, 8.2**

  - [x]* 4.5 Write unit tests for wallet routes
    - Create `apps/api/tests/wallet-routes.unit.test.js`
    - Test missing `walletAddress` field returns 400 (Req 3.2)
    - Test malformed JSON body returns 400 (Req 3.3)
    - Test database failure returns sanitized 500 (Req 6.3, 8.4)
    - Test new wallet not in DB is not treated as blocked (Req 4.3)
    - Test lookup of non-existent address returns 404 (Req 5.2)
    - Test correct HTTP status codes for each error type (Req 8.2)
    - Use Fastify's `inject()` with mocked Prisma client
    - _Requirements: 3.2, 3.3, 4.3, 5.2, 6.3, 8.2, 8.4_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `Wallet` model in the Prisma schema requires no modifications
- All files use `.js` extension with ESM (`"type": "module"`) to match the existing `apps/api` convention
- TypeScript types are expressed via JSDoc annotations or inline comments, consistent with the current codebase

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4"] },
    { "id": 6, "tasks": ["4.5"] }
  ]
}
```
