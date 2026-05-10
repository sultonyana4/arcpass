# Requirements Document

## Introduction

The Wallet Registry is the foundational service for onboarding users into the ArcPass gas sponsorship flow on Arc Network. It provides wallet registration, lookup, and tracking capabilities through a Fastify REST API backed by Prisma/PostgreSQL. This service enables the system to identify first-time wallets, track sponsorship activity, and block abusive wallets — all without authentication, blockchain calls, or external integrations in this initial phase.

## Glossary

- **Wallet_Registry_API**: The Fastify HTTP service that exposes wallet registration and lookup endpoints
- **Wallet_Service**: The business logic layer responsible for wallet operations (registration, lookup, validation)
- **Wallet_Address**: A hexadecimal Ethereum-compatible address string (42 characters: "0x" prefix followed by 40 hex characters)
- **Normalized_Address**: A Wallet_Address converted to lowercase for consistent storage and comparison
- **Blocked_Wallet**: A wallet marked as ineligible for sponsorship due to abuse or policy violation
- **Sponsorship_Count**: An integer tracking how many times a wallet has been registered or re-registered
- **First_Seen_At**: The timestamp recording when a wallet was first registered in the system
- **Last_Seen_At**: The timestamp recording the most recent registration attempt for a wallet

## Requirements

### Requirement 1: Wallet Registration

**User Story:** As a new user, I want to register my wallet address, so that I am onboarded into the ArcPass sponsorship system.

#### Acceptance Criteria

1. WHEN a valid wallet address is submitted via POST /wallets/register, THE Wallet_Registry_API SHALL normalize the address to lowercase, create a new wallet record with the Normalized_Address, First_Seen_At set to the current UTC timestamp, Last_Seen_At set to the current UTC timestamp, and Sponsorship_Count set to 0
2. WHEN a wallet address that already exists in the system is submitted via POST /wallets/register, THE Wallet_Service SHALL update Last_Seen_At to the current UTC timestamp and increment Sponsorship_Count by 1
3. WHEN a wallet is successfully registered for the first time, THE Wallet_Registry_API SHALL return HTTP 201 with the wallet record including id, walletAddress, firstSeenAt, lastSeenAt, and sponsorshipCount
4. WHEN a wallet is re-registered (duplicate), THE Wallet_Registry_API SHALL return HTTP 200 with the updated wallet record including id, walletAddress, firstSeenAt, lastSeenAt, and sponsorshipCount
5. IF the submitted wallet address is missing, empty, or does not match the valid format (0x prefix + 40 hex characters), THEN THE Wallet_Registry_API SHALL return HTTP 400 with an error message indicating the validation failure without creating or modifying any wallet record
6. IF the submitted wallet address belongs to a wallet where isBlocked is true, THEN THE Wallet_Registry_API SHALL return HTTP 403 with an error message indicating the wallet is blocked, without updating Last_Seen_At or Sponsorship_Count

### Requirement 2: Wallet Address Normalization

**User Story:** As a developer, I want wallet addresses normalized to lowercase, so that duplicate detection is case-insensitive and consistent.

#### Acceptance Criteria

1. WHEN a wallet address is received by the Wallet_Service, THE Wallet_Service SHALL convert all alphabetic characters in the address to lowercase before storage or comparison
2. WHEN a wallet address is stored and subsequently looked up using any casing variant of the same address, THE Wallet_Service SHALL return the same wallet record
3. IF a wallet address does not match the format of exactly 42 characters consisting of the prefix "0x" followed by 40 hexadecimal characters, THEN THE Wallet_Service SHALL reject the address with an error message indicating the address format is invalid and SHALL NOT store the address
4. IF a normalized wallet address already exists in storage when a new request is received with a casing variant of that address, THEN THE Wallet_Service SHALL treat it as the same wallet and SHALL NOT create a duplicate record

### Requirement 3: Wallet Address Validation

**User Story:** As a system operator, I want invalid wallet addresses rejected, so that only properly formatted addresses enter the system.

#### Acceptance Criteria

1. WHEN a wallet address that does not match the pattern /^0x[0-9a-fA-F]{40}$/ after trimming leading and trailing whitespace is submitted, THE Wallet_Registry_API SHALL return HTTP 400 with an error message describing the validation failure
2. WHEN a request body is missing the walletAddress field, THE Wallet_Registry_API SHALL return HTTP 400 with an error message indicating the required field is missing
3. WHEN a request body contains malformed JSON, THE Wallet_Registry_API SHALL return HTTP 400 with an error message indicating invalid payload format
4. WHEN a valid wallet address is submitted, THE Wallet_Registry_API SHALL store the address in lowercase hexadecimal form to ensure case-insensitive uniqueness

### Requirement 4: Blocked Wallet Enforcement

**User Story:** As a system operator, I want blocked wallets to be rejected during registration, so that abusive wallets cannot receive sponsorship.

#### Acceptance Criteria

1. WHEN a registration request is received for a wallet where isBlocked is true, THE Wallet_Registry_API SHALL return HTTP 403 with an error message indicating the wallet is blocked
2. WHEN a registration request is received for a wallet where isBlocked is true, THE Wallet_Service SHALL NOT update lastSeenAt and SHALL NOT increment sponsorshipCount
3. IF a registration request is received for a wallet address that does not exist in the database, THEN THE Wallet_Registry_API SHALL treat the wallet as not blocked and proceed with normal registration flow

### Requirement 5: Wallet Lookup

**User Story:** As a developer, I want to look up a wallet by address, so that I can check its registration status and sponsorship history.

#### Acceptance Criteria

1. WHEN a GET request is made to /wallets/:address with a valid registered address, THE Wallet_Registry_API SHALL return HTTP 200 with the wallet record including id, walletAddress, firstSeenAt (ISO 8601 timestamp), lastSeenAt (ISO 8601 timestamp), sponsorshipCount (non-negative integer), and isBlocked (boolean)
2. WHEN a GET request is made to /wallets/:address with an address that does not exist in the system, THE Wallet_Registry_API SHALL return HTTP 404 with an error message indicating the wallet was not found
3. WHEN a GET request is made to /wallets/:address, THE Wallet_Service SHALL normalize the address parameter to lowercase before performing the lookup so that addresses differing only in case resolve to the same wallet record
4. WHEN a GET request is made to /wallets/:address with an address that does not match the pattern of exactly 42 characters starting with "0x" followed by 40 hexadecimal characters (0-9, a-f, A-F), THE Wallet_Registry_API SHALL return HTTP 400 with a validation error message indicating the address format is invalid
5. WHEN a GET request is made to /wallets/:address, THE Wallet_Registry_API SHALL perform a read-only lookup and SHALL NOT modify any wallet fields including lastSeenAt or sponsorshipCount

### Requirement 6: Prisma Integration

**User Story:** As a developer, I want the wallet registry to use the existing Prisma client from @arcpass/shared, so that database access is consistent across the monorepo.

#### Acceptance Criteria

1. THE Wallet_Service SHALL import and use the `prisma` singleton instance exported from @arcpass/shared for all database operations, without instantiating any additional PrismaClient
2. THE Wallet_Service SHALL use the existing Wallet model defined in the shared Prisma schema without modification to the schema file
3. IF a database operation fails, THEN THE Wallet_Registry_API SHALL return HTTP 500 with an error message that does not expose table names, column names, SQL statements, stack traces, or connection strings
4. WHEN the Wallet_Service receives a shutdown signal, THE Wallet_Service SHALL call `prisma.$disconnect()` to release database connections before the process exits

### Requirement 7: Fastify Route Integration

**User Story:** As a developer, I want wallet routes registered as a Fastify plugin, so that the API follows the existing modular route pattern.

#### Acceptance Criteria

1. THE Wallet_Registry_API SHALL register wallet routes as a Fastify plugin under the /wallets prefix using fastify.register() with a { prefix: '/wallets' } option in server.js
2. THE Wallet_Registry_API SHALL export the wallet route plugin as a default async function accepting (fastify, opts) parameters, following the ESM module pattern
3. THE Wallet_Registry_API SHALL use Fastify's built-in JSON schema validation for request body and parameter validation by attaching a schema object to each route's options
4. IF a request fails JSON schema validation, THEN THE Wallet_Registry_API SHALL respond with HTTP 400 status and a response body containing an error message indicating which validation constraint was violated
5. THE Wallet_Registry_API SHALL define route paths within the plugin as relative paths without the /wallets prefix, relying on the plugin prefix option for namespacing

### Requirement 8: Error Response Format

**User Story:** As a developer consuming the API, I want consistent error responses, so that I can handle failures predictably.

#### Acceptance Criteria

1. WHEN an error occurs, THE Wallet_Registry_API SHALL return a JSON response with Content-Type "application/json" containing exactly two fields: "error" (a human-readable string identifying the failure reason) and "statusCode" (a numeric field matching the HTTP response status code)
2. THE Wallet_Registry_API SHALL use the following HTTP status codes: 400 for validation errors (missing or invalid fields), 403 for blocked wallets, 404 for wallet not found on lookup, and 500 for unexpected server errors
3. IF the request body is not valid JSON, THEN THE Wallet_Registry_API SHALL return a 400 status code with an error response indicating that the request body could not be parsed
4. IF an unexpected server error occurs, THEN THE Wallet_Registry_API SHALL return a 500 error response that does not expose internal details such as stack traces or database error messages
