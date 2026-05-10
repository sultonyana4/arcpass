# Requirements Document

## Introduction

This document defines the requirements for setting up a local PostgreSQL runtime and Prisma integration for the ArcPass monorepo. The feature provides a reproducible local development database environment using Docker Compose, integrates with the existing `packages/shared` Prisma package, and establishes conventions for environment configuration, migration workflows, and connection validation across all workspace apps (API, Worker).

## Glossary

- **Docker_Compose_Service**: A containerized service definition within a `docker-compose.yml` file that runs PostgreSQL locally
- **Database_Volume**: A named Docker volume that persists PostgreSQL data across container restarts
- **DATABASE_URL**: The PostgreSQL connection string environment variable consumed by Prisma Client
- **Prisma_CLI**: The Prisma command-line tool used for schema migrations, client generation, and database introspection
- **Prisma_Studio**: A web-based GUI provided by Prisma for browsing and editing database records
- **Healthcheck**: A Docker container health probe that verifies PostgreSQL is accepting connections
- **Migration**: A versioned schema change managed by Prisma Migrate that transforms the database schema
- **Connection_Validator**: A runtime utility in `packages/shared` that verifies DATABASE_URL is set and the database is reachable
- **Workspace_Script**: A pnpm workspace-level script defined in the root `package.json` that orchestrates cross-package commands
- **Shared_Package**: The `@arcpass/shared` package located at `packages/shared` containing Prisma schema, client, and database utilities

## Requirements

### Requirement 1: Docker Compose PostgreSQL Service

**User Story:** As a developer, I want a Docker Compose service that runs PostgreSQL locally, so that I have a consistent database environment without manual installation.

#### Acceptance Criteria

1. THE Docker_Compose_Service SHALL define a PostgreSQL 16 service using the official `postgres:16-alpine` image
2. THE Docker_Compose_Service SHALL expose PostgreSQL on host port 5432 mapped to container port 5432
3. THE Docker_Compose_Service SHALL configure the database name as `arcpass_dev` via the `POSTGRES_DB` environment variable
4. THE Docker_Compose_Service SHALL configure the database user as `arcpass` via the `POSTGRES_USER` environment variable
5. THE Docker_Compose_Service SHALL configure the database password as `arcpass_local` via the `POSTGRES_PASSWORD` environment variable
6. THE Docker_Compose_Service SHALL be defined in a `docker-compose.yml` file located at the repository root
7. THE Docker_Compose_Service SHALL assign the service name `postgres` within the Docker Compose file

### Requirement 2: Persistent Docker Volume

**User Story:** As a developer, I want database data to persist across container restarts, so that I do not lose development data when stopping Docker.

#### Acceptance Criteria

1. THE Docker_Compose_Service SHALL mount the named volume `arcpass_pgdata` to the PostgreSQL data directory `/var/lib/postgresql/data`
2. THE Database_Volume SHALL be declared as a named volume called `arcpass_pgdata` in the Docker Compose top-level `volumes` section using the default local driver
3. WHEN the Docker container is stopped via `docker compose stop` and restarted via `docker compose up`, THE Database_Volume SHALL retain all previously stored data such that database rows inserted before the stop are queryable after the restart
4. WHEN the Docker Compose services are removed via `docker compose down` without the `--volumes` flag, THE Database_Volume SHALL retain all previously stored data

### Requirement 3: DATABASE_URL Strategy

**User Story:** As a developer, I want a clear and consistent DATABASE_URL configuration strategy, so that all workspace apps connect to the same local database.

#### Acceptance Criteria

1. THE Shared_Package SHALL document the DATABASE_URL format as `postgresql://arcpass:arcpass_local@localhost:5432/arcpass_dev?schema=public` in its `.env.example` file
2. THE Shared_Package SHALL read DATABASE_URL exclusively from the `process.env.DATABASE_URL` environment variable with no hardcoded fallback or default value
3. IF DATABASE_URL is not set, is empty, or contains only whitespace, THEN THE Connection_Validator SHALL throw an error whose message includes the text "DATABASE_URL" and the expected URL format starting with `postgresql://`
4. THE root repository SHALL provide a `.env.example` file documenting the default local DATABASE_URL value matching the format in criterion 1
5. THE `.gitignore` at the repository root SHALL include patterns that exclude both `.env` and `.env.*` files while preserving `.env.example` files from exclusion

### Requirement 4: Prisma Migration Runtime Workflow

**User Story:** As a developer, I want a clear migration workflow using Prisma, so that I can evolve the database schema safely during development.

#### Acceptance Criteria

1. WHEN a developer runs the `migrate:dev` script in the Shared_Package, THE Prisma_CLI SHALL create a new migration and apply it to the local database, and then regenerate the Prisma Client
2. WHEN a developer runs the `migrate:deploy` script in the Shared_Package, THE Prisma_CLI SHALL apply all pending migrations to the target database without creating new ones
3. WHEN a developer runs the `db:reset` script in the Shared_Package, THE Prisma_CLI SHALL drop the database, recreate it, apply all migrations, and regenerate the Prisma Client
4. WHEN a migration is created, THE Prisma_CLI SHALL store the migration files in the `packages/shared/prisma/migrations` directory
5. THE root `package.json` SHALL include a Workspace_Script `db:migrate` that runs `migrate:dev` in the Shared_Package via `pnpm --filter @arcpass/shared`
6. IF the `DATABASE_URL` environment variable is not set when a migration script is executed, THEN THE Prisma_CLI SHALL exit with a non-zero exit code and output an error message indicating the missing connection string
7. IF a migration fails due to a schema conflict or database connectivity error, THEN THE Prisma_CLI SHALL exit with a non-zero exit code and leave previously applied migrations intact

### Requirement 5: Prisma Studio Support

**User Story:** As a developer, I want to browse and edit database records through a GUI, so that I can inspect data during development without writing queries.

#### Acceptance Criteria

1. THE Shared_Package SHALL include a `studio` script in its `package.json` that executes the `prisma studio` command
2. WHEN the `studio` script is executed, THE Prisma_CLI SHALL start a local HTTP server on the default port 5555 serving a web-based interface that displays all tables defined in the Prisma schema
3. THE root `package.json` SHALL include a Workspace_Script `db:studio` that runs the `studio` script in the Shared_Package via `pnpm --filter @arcpass/shared studio`
4. IF the database is unreachable when the `studio` script is executed, THEN THE Prisma_CLI SHALL exit with a non-zero exit code and output an error message indicating the connection failure

### Requirement 6: Healthcheck Strategy

**User Story:** As a developer, I want Docker to verify PostgreSQL is ready before dependent services start, so that applications do not fail on startup due to an unavailable database.

#### Acceptance Criteria

1. THE Docker_Compose_Service SHALL define a healthcheck that runs `pg_isready -U arcpass -d arcpass_dev`
2. THE Healthcheck SHALL execute at an interval of 5 seconds with a start period of 10 seconds to allow initial container startup
3. THE Healthcheck SHALL allow a timeout of 5 seconds per check
4. THE Healthcheck SHALL retry up to 5 times before marking the container as unhealthy
5. WHEN the Healthcheck reports healthy status, THE Docker_Compose_Service SHALL be available as a dependency using `condition: service_healthy` in the `depends_on` configuration of dependent services
6. WHEN a dependent service declares a `depends_on` relationship on the Docker_Compose_Service with `condition: service_healthy`, THE Docker_Compose_Service SHALL block that dependent service from starting until the Healthcheck passes

### Requirement 7: pnpm Workspace Integration

**User Story:** As a developer, I want root-level workspace scripts for common database operations, so that I can manage the database without navigating to specific packages.

#### Acceptance Criteria

1. THE root `package.json` SHALL include a `db:up` Workspace_Script that executes `docker compose up -d` to start the PostgreSQL service defined in the root `docker-compose.yml` in detached mode
2. THE root `package.json` SHALL include a `db:down` Workspace_Script that executes `docker compose down` to stop the PostgreSQL service defined in the root `docker-compose.yml`
3. THE root `package.json` SHALL include a `db:generate` Workspace_Script that runs the `generate` script in the Shared_Package via `pnpm --filter @arcpass/shared generate`
4. THE root `package.json` SHALL include a `db:migrate` Workspace_Script that runs the `migrate:dev` script in the Shared_Package via `pnpm --filter @arcpass/shared migrate:dev`
5. THE root `package.json` SHALL include a `db:studio` Workspace_Script that runs the `studio` script in the Shared_Package via `pnpm --filter @arcpass/shared studio`
6. THE root `package.json` SHALL include a `db:reset` Workspace_Script that runs the `db:reset` script in the Shared_Package via `pnpm --filter @arcpass/shared db:reset`
7. WHEN a Workspace_Script targeting the Shared_Package is executed and the `@arcpass/shared` package does not contain the referenced script, THE pnpm CLI SHALL exit with a non-zero exit code

### Requirement 8: Local Development Workflow

**User Story:** As a developer, I want a documented step-by-step workflow for starting local development with the database, so that new contributors can onboard without confusion.

#### Acceptance Criteria

1. THE repository SHALL include a `docs/local-development.md` file documenting the database setup workflow
2. THE documentation SHALL provide the workflow as a numbered sequence of exact shell commands covering: environment variable configuration from `.env.example`, starting the Docker PostgreSQL container, running Prisma migrations, generating the Prisma client, and starting application services
3. THE documentation SHALL list all prerequisite software with minimum version requirements: Docker, Node.js (major version), and pnpm (major version matching the `packageManager` field in root `package.json`)
4. THE documentation SHALL include troubleshooting guidance for at least 3 common issues (including port conflicts and connection failures), where each issue entry contains: symptom description, probable cause, and resolution command or action
5. THE documentation SHALL include a verification step at the end of the workflow that the developer can run to confirm the database is reachable and migrations are applied, with expected success output described

### Requirement 9: Worker and API Shared Database Access

**User Story:** As a developer, I want both the API and Worker apps to access the database through the shared Prisma client, so that database logic is centralized and consistent.

#### Acceptance Criteria

1. THE `apps/api` package SHALL declare `@arcpass/shared` as a workspace dependency in its `package.json`
2. THE `apps/worker` package SHALL declare `@arcpass/shared` as a workspace dependency in its `package.json`
3. WHEN the API or Worker imports the Prisma client from `@arcpass/shared`, THE Shared_Package SHALL return the same PrismaClient instance for every import within a single process
4. THE Shared_Package SHALL export the `prisma` PrismaClient instance, the generated Prisma types, and the `validateDatabaseUrl` utility from its package entry point
5. IF the `DATABASE_URL` environment variable is not set or is empty when the PrismaClient is first instantiated, THEN THE Shared_Package SHALL throw an error indicating that `DATABASE_URL` is missing and including the expected connection string format

### Requirement 10: Environment Variable Documentation

**User Story:** As a developer, I want all required environment variables documented with examples, so that I can configure my local environment correctly.

#### Acceptance Criteria

1. THE root `.env.example` file SHALL exist and SHALL document `DATABASE_URL` with the value `postgresql://arcpass:arcpass_local@localhost:5432/arcpass_dev?schema=public`
2. THE `packages/shared/.env.example` SHALL document `DATABASE_URL` with the value `postgresql://arcpass:arcpass_local@localhost:5432/arcpass_dev?schema=public`
3. EACH `.env.example` file SHALL include a comment above the `DATABASE_URL` variable describing its purpose (Prisma database connection) and the URL component format (`postgresql://<user>:<password>@<host>:<port>/<database>?schema=<schema>`)
4. EACH `.env.example` file SHALL include a comment stating that `.env` files must be loaded by the consuming application (e.g., `apps/api`, `apps/worker`) and are not auto-loaded by the Shared_Package
5. EACH `.env.example` file SHALL be copyable to `.env` without modification and produce a valid connection to the local Docker Compose PostgreSQL instance

### Requirement 11: Connection Validation

**User Story:** As a developer, I want the application to validate the database connection at startup, so that I receive a clear error message if the database is unreachable.

#### Acceptance Criteria

1. IF DATABASE_URL is not set, is empty, or contains only whitespace, THEN THE Connection_Validator SHALL throw an error with a message that includes the environment variable name and the expected connection string format (`postgresql://<user>:<password>@<host>:<port>/<database>`)
2. IF DATABASE_URL is set but the database is unreachable due to connection failure (DNS resolution failure, connection refused, or authentication failure), THEN THE Connection_Validator SHALL throw an error within 5 seconds indicating the connection failed and including the host and port that were attempted
3. THE Connection_Validator SHALL be importable from `@arcpass/shared` as a named export for use in application startup sequences
4. IF DATABASE_URL does not begin with a valid `postgresql://` or `postgres://` scheme, THEN THE Connection_Validator SHALL throw a format validation error before attempting a connection, indicating the expected scheme
5. WHEN DATABASE_URL passes format validation, THE Connection_Validator SHALL attempt a connection to confirm reachability before returning success

### Requirement 12: Safe Local Development Defaults

**User Story:** As a developer, I want safe default values for local development, so that I cannot accidentally connect to a production database during development.

#### Acceptance Criteria

1. THE Docker_Compose_Service SHALL use non-production credentials: user `arcpass`, password `arcpass_local`, database `arcpass_dev`
2. THE `.env.example` files SHALL contain a default `DATABASE_URL` value using `localhost` as the database host with the credentials defined in criterion 1 (e.g., `postgresql://arcpass:arcpass_local@localhost:5432/arcpass_dev?schema=public`)
3. WHEN the application starts and `NODE_ENV` is not set to `production`, IF the `DATABASE_URL` contains a host other than `localhost` or `127.0.0.1`, THEN THE Connection_Validator SHALL log a warning message to stdout indicating that a non-local database host was detected in a non-production environment
4. THE Docker_Compose_Service SHALL bind PostgreSQL exclusively to `localhost` by mapping port `127.0.0.1:5432:5432`
5. IF `NODE_ENV` is not set or is undefined, THEN THE Connection_Validator SHALL treat the environment as non-production for the purpose of the non-local host warning
