# Implementation Plan: API Service Initialization

## Overview

Initialize the `apps/api` Fastify backend as a production-ready service with ESM configuration, structured logging (Pino), environment variable loading with validation, graceful shutdown, a health check endpoint, and modular directory structure. Implementation uses JavaScript with ESM modules, Vitest for testing, and fast-check for property-based tests.

## Tasks

- [x] 1. Configure ESM package and project setup
  - [x] 1.1 Update package.json for ESM and scripts
    - Add `"type": "module"` to `apps/api/package.json`
    - Change `"main"` field to `"src/server.js"`
    - Add `"start": "node src/server.js"` script
    - Add `"dev": "node --watch src/server.js"` script
    - Add `"test": "vitest --run"` script
    - Add devDependencies: `vitest`, `fast-check`
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [x] 1.2 Create the config module at `src/lib/config.js`
    - Import and call `dotenv.config()` at module top
    - Read `PORT` and `LOG_LEVEL` from `process.env`
    - Apply defaults: PORT=4000, LOG_LEVEL="info"
    - Validate PORT is an integer in [1, 65535], throw descriptive error if invalid
    - Validate LOG_LEVEL is one of: fatal, error, warn, info, debug, trace; throw descriptive error if invalid
    - Export a `Object.freeze()`-ed config object with `port` (number) and `logLevel` (string)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 2. Implement server entry point and health route
  - [x] 2.1 Create the server entry point at `src/server.js`
    - Import Fastify and config module
    - Create Fastify instance with `logger: { level: config.logLevel, timestamp: pino.stdTimeFunctions.isoTime }`
    - Register plugins from `plugins/` directory (empty for now, but pattern established)
    - Register health route plugin from `routes/health.js`
    - Call `app.listen({ port: config.port, host: '0.0.0.0' })`
    - Wrap startup in try/catch: log error and `process.exit(1)` on failure
    - Register SIGTERM and SIGINT handlers for graceful shutdown with 10s timeout
    - On signal: log signal, start 10s force-exit timer (unref'd), call `app.close()`, exit 0 on success or exit 1 on error/timeout
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 6.4_

  - [x] 2.2 Create the health route plugin at `src/routes/health.js`
    - Export default async Fastify plugin function
    - Register `GET /health` handler
    - Return `{ status: "ok", uptime: Math.floor(process.uptime()) }` with 200 status
    - _Requirements: 5.1, 5.2, 5.3, 6.2_

- [x] 3. Checkpoint - Verify server starts and health endpoint works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add unit and integration tests
  - [x] 4.1 Set up test infrastructure
    - Create `vitest.config.js` in `apps/api` with ESM configuration
    - Create `tests/` directory structure
    - _Requirements: 1.1, 1.2_

  - [x] 4.2 Write unit tests for config module
    - Test PORT defaults to 4000 when env var unset
    - Test LOG_LEVEL defaults to "info" when env var unset
    - Test config object has `port` and `logLevel` keys
    - Test config object is frozen (immutable)
    - Test no error thrown when .env file is missing
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 4.3 Write integration tests for health endpoint
    - Test GET /health returns 200 with `Content-Type: application/json`
    - Test response body contains `status: "ok"`
    - Test response body contains `uptime` as a non-negative integer
    - Test server binds to configured port
    - _Requirements: 5.1, 5.2, 5.3, 4.1_

  - [x] 4.4 Write integration tests for server lifecycle
    - Test server binds to 0.0.0.0
    - Test startup failure (port conflict) exits with code 1
    - Test startup log message contains host and port
    - Test request logging includes method and URL
    - _Requirements: 3.4, 3.5, 4.2, 7.4_

- [x] 5. Add property-based tests for correctness properties
  - [ ]* 5.1 Write property test for port validation
    - **Property 1: Port validation accepts only valid integers in [1, 65535]**
    - Generate valid integers in [1, 65535] and verify config accepts them
    - Generate invalid values (negatives, zero, >65535, floats, non-numeric strings, empty strings) and verify config throws
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 2.6**

  - [ ]* 5.2 Write property test for log level validation
    - **Property 2: Log level validation accepts only the six valid Pino levels**
    - Generate strings from valid set {fatal, error, warn, info, debug, trace} and verify config accepts them
    - Generate arbitrary strings not in the valid set and verify config throws
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 2.7, 7.5**

  - [ ]* 5.3 Write property test for log entry structure
    - **Property 3: Log entries are well-formed structured JSON**
    - Generate random message strings at random valid levels
    - Capture logger stdout, parse JSON, verify `level` (numeric), `time` (ISO 8601), and `msg` fields present
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 5.4 Write property test for log level filtering
    - **Property 4: Log level filtering suppresses messages below the configured threshold**
    - Generate random (configLevel, messageLevel) pairs from valid levels
    - Verify message appears in output if and only if messageLevel severity >= configLevel severity
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 7.3**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The server uses JavaScript with ESM (`"type": "module"`) per the existing project setup
- All code follows the modular architecture pattern: no business logic in routes or server entry point

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "4.1"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4"] }
  ]
}
```
