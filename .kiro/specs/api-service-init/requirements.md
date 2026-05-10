# Requirements Document

## Introduction

Initialize the `apps/api` service as a production-ready Fastify backend inside the ArcPass monorepo. This is the foundation layer that establishes the modular project structure, ESM configuration, structured logging, environment loading, and a health check endpoint. No database or blockchain logic is included at this stage.

## Glossary

- **API_Service**: The Fastify HTTP server application located at `apps/api`
- **Health_Endpoint**: A GET /health route that returns service status information
- **Config_Module**: The module responsible for loading and validating environment variables
- **Logger**: The structured logging system provided by Fastify's built-in Pino logger
- **Plugin**: A Fastify plugin that encapsulates reusable server functionality
- **Route_Module**: A Fastify plugin that registers HTTP route handlers

## Requirements

### Requirement 1: ESM Package Configuration

**User Story:** As a developer, I want the API service configured as an ES module package, so that I can use modern import/export syntax throughout the codebase.

#### Acceptance Criteria

1. THE API_Service SHALL declare `"type": "module"` in its package.json
2. THE API_Service SHALL use ESM `import`/`export` syntax exclusively (no `require()` or `module.exports`) in all `.js` files under the `src/` directory
3. THE API_Service SHALL define a `"start"` script in package.json that executes `src/server.js` using the `node` command
4. THE API_Service SHALL define a `"dev"` script in package.json that executes `src/server.js` using the `node --watch` flag
5. THE API_Service SHALL declare the `"main"` field in package.json pointing to `src/server.js`

### Requirement 2: Environment Configuration

**User Story:** As a developer, I want environment variables loaded from a .env file with sensible defaults, so that the service can be configured per deployment environment.

#### Acceptance Criteria

1. WHEN the API_Service starts, THE Config_Module SHALL load environment variables from a .env file using dotenv
2. IF the .env file does not exist, THEN THE Config_Module SHALL continue startup using process environment variables and defaults without throwing an error
3. THE Config_Module SHALL export a configuration object containing at minimum the following keys: PORT and LOG_LEVEL
4. IF process.env.PORT is not set, THEN THE Config_Module SHALL default PORT to 4000
5. IF process.env.LOG_LEVEL is not set, THEN THE Config_Module SHALL default LOG_LEVEL to "info"
6. IF PORT is set to a value that is not an integer between 1 and 65535, THEN THE Config_Module SHALL throw an error at startup indicating the invalid PORT value
7. IF LOG_LEVEL is set to a value not in the set ("fatal", "error", "warn", "info", "debug", "trace"), THEN THE Config_Module SHALL throw an error at startup indicating the invalid LOG_LEVEL value

### Requirement 3: Server Initialization

**User Story:** As a developer, I want a clean server entry point that initializes Fastify with structured logging and registers plugins and routes, so that the application starts predictably.

#### Acceptance Criteria

1. THE API_Service SHALL create a Fastify instance with JSON-formatted structured logging enabled
2. THE API_Service SHALL configure the Logger with the log level from the Config_Module, defaulting to "info" if the configured value is missing or not one of the valid levels (trace, debug, info, warn, error, fatal)
3. THE API_Service SHALL register all plugins before registering routes
4. WHEN the API_Service starts successfully, THE Logger SHALL output a message containing the bound host and port
5. IF the API_Service fails to start, THEN THE Logger SHALL output an error message indicating the failure reason and the process SHALL exit with code 1

### Requirement 4: Server Binding

**User Story:** As a developer, I want the server to bind to a configurable port and host, so that it works in both local development and containerized deployments.

#### Acceptance Criteria

1. THE API_Service SHALL bind to the port specified by the Config_Module
2. THE API_Service SHALL bind to host `0.0.0.0` to allow connections in containerized environments
3. WHEN the API_Service receives a SIGTERM signal, THE API_Service SHALL perform a graceful shutdown by closing the Fastify instance within 10 seconds
4. WHEN the API_Service receives a SIGINT signal, THE API_Service SHALL perform the same graceful shutdown as for SIGTERM
5. IF the graceful shutdown does not complete within 10 seconds, THEN THE API_Service SHALL force exit the process with exit code 1

### Requirement 5: Health Check Endpoint

**User Story:** As an operator, I want a GET /health endpoint that returns service status, so that load balancers and monitoring systems can verify the service is running.

#### Acceptance Criteria

1. WHEN a GET request is received at `/health`, THE Health_Endpoint SHALL respond with HTTP status 200 and a `Content-Type: application/json` header within 500ms
2. WHEN a GET request is received at `/health`, THE Health_Endpoint SHALL return a JSON body containing a `status` field with value `"ok"`
3. WHEN a GET request is received at `/health`, THE Health_Endpoint SHALL return a JSON body containing an `uptime` field with the process uptime as a non-negative integer representing whole seconds
4. IF the service is unable to serve requests due to a failed dependency or incomplete startup, THEN THE Health_Endpoint SHALL respond with HTTP status 503 and a JSON body containing a `status` field with a value of `"unavailable"`

### Requirement 6: Modular Project Structure

**User Story:** As a developer, I want a clean modular directory structure, so that future features can be added without refactoring the foundation.

#### Acceptance Criteria

1. THE API_Service SHALL organize source code into the following directories: `routes/` for HTTP endpoint handlers, `plugins/` for Fastify plugin registrations that extend the server instance, `services/` for business logic modules, and `lib/` for stateless utility functions and helpers
2. THE API_Service SHALL register each route module as a Fastify plugin exported from the `routes/` directory
3. THE API_Service SHALL register cross-cutting concerns as Fastify plugins from the `plugins/` directory
4. THE API_Service SHALL limit the server entry point to Fastify instance creation, environment configuration loading, plugin registration calls, route registration calls, and server listen invocation, containing no business logic, no route handler definitions, and no direct database queries
5. WHEN a new feature is added, THE API_Service SHALL allow the feature to be implemented by adding files to the existing directory structure without requiring modifications to unrelated modules or the server entry point beyond a plugin registration call

### Requirement 7: Structured Logging

**User Story:** As an operator, I want structured JSON logging, so that logs are machine-parseable and compatible with cloud logging services.

#### Acceptance Criteria

1. THE Logger SHALL output each log entry as a single-line valid JSON object containing at minimum a level field, a timestamp field, and a message field
2. THE Logger SHALL include a timestamp in ISO 8601 format in each log entry
3. THE Logger SHALL support configurable log levels via the Config_Module, where valid levels are: fatal, error, warn, info, debug, and trace
4. WHEN a request is received, THE Logger SHALL log the request method and URL at the "info" level
5. IF the configured LOG_LEVEL is set to a value not in the valid levels list, THEN THE Config_Module SHALL throw a descriptive error at startup
