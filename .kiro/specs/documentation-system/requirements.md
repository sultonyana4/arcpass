# Requirements Document

## Introduction

This document specifies the requirements for a complete professional documentation system for the ArcPass monorepo. The documentation will reside in the `/docs` directory and be structured for future migration into Mintlify documentation hosting. The system covers all aspects of ArcPass: architecture, API, infrastructure, security, operations, and developer onboarding.

## Glossary

- **Documentation_System**: The complete set of Markdown files, diagrams, and cross-links residing in the `/docs` directory that describe the ArcPass project
- **Mintlify**: A documentation hosting platform that consumes structured Markdown with specific frontmatter and navigation conventions
- **Mermaid_Diagram**: A text-based diagramming syntax embedded in Markdown code blocks that renders architecture, sequence, and flow diagrams
- **Cross_Link**: A relative Markdown link connecting one documentation page to another within the `/docs` directory
- **Frontmatter**: YAML metadata at the top of a Markdown file used by documentation platforms for navigation and page configuration
- **Index_Page**: The root documentation page (`/docs/index.md`) serving as the entry point and navigation hub
- **Section**: A top-level directory within `/docs` grouping related documentation pages (e.g., `/docs/architecture`, `/docs/api`)
- **Environment_Variable_Table**: A Markdown table listing configuration variables with columns for name, required status, default value, and description
- **Deployment_Checklist**: An ordered list of verification steps confirming a successful production deployment
- **Runbook**: An operational procedure document with step-by-step instructions for common maintenance and recovery tasks

## Requirements

### Requirement 1: Documentation Directory Structure

**User Story:** As a developer, I want a well-organized documentation directory structure, so that I can find relevant information quickly and the documentation scales as the project grows.

#### Acceptance Criteria

1. THE Documentation_System SHALL contain the following top-level section directories under `/docs`: `getting-started`, `architecture`, `backend`, `frontend`, `contracts`, `infrastructure`, `api`, `security`, `operations`, `roadmap`, and `contributing`
2. THE Documentation_System SHALL place all documentation files within the `/docs` directory at the repository root
3. WHEN a new section is created, THE Documentation_System SHALL contain at least one Markdown file (`.md` extension) within that section directory, named using lowercase kebab-case (e.g., `overview.md`, `setup-guide.md`)
4. THE Index_Page SHALL exist at `/docs/index.md` and contain a navigable list of links to each top-level section directory defined in criterion 1

### Requirement 2: Index Page

**User Story:** As a developer or stakeholder, I want a documentation landing page, so that I can understand the project vision, core goals, and navigate to detailed sections.

#### Acceptance Criteria

1. THE Index_Page SHALL include a project overview describing ArcPass as onboarding infrastructure for Arc Network
2. THE Index_Page SHALL include the project vision statement and core goals (solving the cold-start gas problem, relay execution, developer integration)
3. THE Index_Page SHALL include a high-level architecture summary with a Mermaid_Diagram showing at minimum the following system components and their relationships: Frontend (web), API service, Worker service, PostgreSQL database, and Smart Contracts (SponsorVault, SponsorshipRegistry)
4. THE Index_Page SHALL include Cross_Links to every top-level Section defined in Requirement 1 (`getting-started`, `architecture`, `backend`, `frontend`, `contracts`, `infrastructure`, `api`, `security`, `operations`, `roadmap`, and `contributing`) using relative paths
5. THE Index_Page SHALL include Mintlify-compatible YAML frontmatter with a `title` field of 60 characters or fewer and a `description` field of 160 characters or fewer

### Requirement 3: Getting Started Documentation

**User Story:** As a new developer, I want clear setup instructions, so that I can run the ArcPass project locally within a single session.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide an `installation.md` file in the `getting-started` section covering local development setup with prerequisites (Node.js 22+, pnpm 10.33+, Docker, Foundry) including version-check commands for each prerequisite
2. THE `installation.md` file SHALL include step-by-step Docker setup instructions for running PostgreSQL and the full stack, with a minimum of 4 numbered steps covering: container startup, Prisma client generation, database migration, and service launch
3. THE `installation.md` file SHALL include an Environment_Variable_Table listing at least 6 required variables and at least 10 optional variables, each row containing the variable name, required/optional designation, default value (or "none"), and a one-sentence description
4. THE `installation.md` file SHALL include a development workflow section documenting at minimum the following command categories: dev server startup (`pnpm dev`), validation (`pnpm validate`), and database operations (`pnpm db:up`, `pnpm db:down`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:reset`)
5. THE `installation.md` file SHALL include a verification section describing a command sequence that confirms successful setup, ending with an observable success indicator (server responding on the configured port or tests passing)
6. THE Documentation_System SHALL provide a `project-structure.md` file in the `getting-started` section explaining the monorepo layout
7. THE `project-structure.md` file SHALL describe the responsibilities of each workspace (`apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/sdk`, `packages/ui`, `contracts`) with a one-sentence summary per workspace
8. THE `project-structure.md` file SHALL include a Mermaid_Diagram showing runtime relationships between workspaces, containing at minimum the API, Worker, PostgreSQL, and Arc Network nodes with labeled edges indicating data flow direction

### Requirement 4: Architecture Documentation

**User Story:** As a developer or architect, I want comprehensive architecture documentation, so that I can understand the full system design and request flow.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `system-overview.md` file in the `docs/architecture/` directory describing the request flow through all stages: client request → Fastify API (validation, rate limiting, replay protection) → PostgreSQL persistence → Worker pickup → on-chain relay via SponsorVault → confirmation and status update
2. THE `system-overview.md` file SHALL include a Mermaid_Diagram showing Docker networking with all containers (PostgreSQL, Worker, and any additional services defined in docker-compose.yml), their network connections, exposed ports, and startup dependencies
3. THE `system-overview.md` file SHALL describe the Next.js API proxy pattern used by the web frontend to communicate with the Fastify API, including the request path from browser through Next.js server-side route to the Fastify backend
4. THE `system-overview.md` file SHALL describe the sponsorship lifecycle covering all states (pending, approved, relayed, completed, failed, rejected) and the valid transitions between them, from wallet registration through relay execution to on-chain confirmation
5. THE Documentation_System SHALL provide a `runtime-flow.md` file in the `docs/architecture/` directory describing runtime execution paths for both nominal and error scenarios
6. THE `runtime-flow.md` file SHALL include a Mermaid sequence diagram for the wallet registration flow showing participants (Client, Fastify API, PostgreSQL) and the request/response interactions including validation failure responses
7. THE `runtime-flow.md` file SHALL include a Mermaid sequence diagram for the sponsorship execution flow showing participants (Poller, Processor, PostgreSQL, Relay Executor, Arc Network) and covering the path from poll discovery → row-level lock acquisition → status transitions → on-chain relay call → receipt confirmation, including the failure/retry branch
8. THE `runtime-flow.md` file SHALL describe the worker operational mechanics including: poll interval (configurable via POLL_INTERVAL_MS), batch size (configurable via BATCH_SIZE), row-level locking strategy (SELECT FOR UPDATE SKIP LOCKED), stale-relayed request recovery, graceful shutdown behavior (SIGTERM/SIGINT handling with bounded drain timeout), and chain ID verification at startup

### Requirement 5: Backend API Documentation

**User Story:** As a backend developer, I want detailed API architecture documentation, so that I can understand the service layering, plugin system, and validation approach.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide an `api-architecture.md` file in the `backend` section describing the Fastify 5.x plugin-based architecture
2. THE `api-architecture.md` file SHALL describe the ordered plugin registration sequence (CORS → security headers → correlation ID → content-type check → replay protection → error handler → routes → not-found handler) including a one-sentence purpose for each plugin
3. THE `api-architecture.md` file SHALL describe the JSON Schema validation approach with `additionalProperties: false` enforcement, including how schema validation errors are translated into human-readable field-level messages
4. THE `api-architecture.md` file SHALL describe the error handling strategy including the list of custom error classes (ValidationError, BlockedWalletError, WalletNotFoundError, SponsorshipNotFoundError, RateLimitError, InvalidStatusTransitionError), their mapped HTTP status codes, and the structured response shape containing error message and status code fields
5. THE `api-architecture.md` file SHALL describe the service layer pattern by documenting the separation of route handlers (in `routes/`) from business logic (in `services/`) and input validation utilities (in `lib/`), with at least one example showing the delegation flow from route to service
6. THE Documentation_System SHALL provide a `database.md` file in the `backend` section describing the PostgreSQL architecture
7. THE `database.md` file SHALL describe the Prisma ORM usage including schema location (`packages/shared/prisma/schema.prisma`), client generation command, and migration workflow (creating, naming, and applying migrations)
8. THE `database.md` file SHALL describe the status transitions for each stateful model: SponsorshipRequest (pending → approved → relayed → completed | failed | rejected) and RelayTransaction (queued → submitted → confirmed | failed)
9. THE `database.md` file SHALL include a Mermaid entity-relationship diagram showing model relationships (Wallet → SponsorshipRequest → RelayTransaction, plus standalone RateLimit) and their indexed columns

### Requirement 6: Frontend Documentation

**User Story:** As a frontend developer, I want architecture documentation for the web application, so that I can understand the component structure and API integration pattern.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `frontend-architecture.md` file in the `/docs/frontend` directory describing the Next.js 16 App Router architecture, including the use of the `app/` directory for file-based routing and the distinction between page routes (`page.tsx`) and API route handlers (`route.ts`)
2. THE `frontend-architecture.md` file SHALL describe the client/server component boundary, specifying that server components are the default for pages performing data fetching (e.g., dashboard page using `force-dynamic`) and that client components (marked with `"use client"`) are used for interactive UI requiring React hooks (useState, useEffect, useCallback) such as forms, refresh buttons, and status polling
3. THE `frontend-architecture.md` file SHALL describe the API proxy pattern where the catch-all Next.js route handler at `app/api/backend/[...path]/route.ts` forwards all browser requests to the internal Fastify API service via the `API_URL_INTERNAL` environment variable, including the client-side resolution that uses the relative path `/api/backend` in the browser and direct service-to-service URLs on the server
4. THE `frontend-architecture.md` file SHALL describe state management patterns used in the application, specifying that the application uses React hooks (useState, useCallback, useEffect) for local component state, a centralized API client module (`lib/api-client.ts`) for all data fetching, a centralized environment configuration module (`config/env.ts`), and Next.js `router.refresh()` for server component re-fetching
5. THE `frontend-architecture.md` file SHALL describe the infrastructure dashboard page functionality, which displays real-time health status of system components (API Service, PostgreSQL Database, Relay Worker, and RPC Connectivity) and network configuration (Chain ID, SponsorVault address, SponsorshipRegistry address)
6. WHEN describing the component organization, THE `frontend-architecture.md` file SHALL document the directory structure convention: `components/ui/` for reusable presentational components, `components/features/` for domain-specific interactive components, and `components/layout/` for page-level structural components

### Requirement 7: Smart Contracts Documentation

**User Story:** As a smart contract developer or auditor, I want comprehensive contract documentation, so that I can understand the on-chain security model and integration points.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `contracts-overview.md` file in the `contracts/` directory that describes both SponsorVault and SponsorshipRegistry contracts, including each contract's purpose, public functions, access restrictions, and emitted events
2. THE `contracts-overview.md` file SHALL describe the owner/operator authorization model specifying which functions are owner-only (initializeRegistry, setOperator, setPerTransactionLimit, emergencyWithdraw) and which are operator-only (sponsorTransfer)
3. THE `contracts-overview.md` file SHALL describe the relay assumptions including the checks-effects-interactions pattern used in sponsorTransfer and the AlreadySponsored guard that prevents duplicate sponsorship for the same recipient
4. THE `contracts-overview.md` file SHALL describe security mechanisms: per-transaction limit enforced on each sponsorTransfer call, owner-only emergency withdrawal, immutable vault address in SponsorshipRegistry set at construction, and vault-only write restriction on recordSponsorship
5. THE `contracts-overview.md` file SHALL include a Mermaid_Diagram in valid Mermaid syntax showing the contract interaction flow for a sponsorTransfer call including SponsorVault, SponsorshipRegistry, and the recipient as distinct nodes
6. THE `contracts-overview.md` file SHALL describe the deployment process listing each of the 4 phases individually: (1) deploy SponsorVault, (2) deploy SponsorshipRegistry with vault address, (3) initialize registry in vault via one-time owner call, and (4) validate deployment integrity
7. THE `contracts-overview.md` file SHALL describe the two-phase initialization pattern that breaks the circular constructor dependency between SponsorVault and SponsorshipRegistry, specifying that initializeRegistry can only be called once

### Requirement 8: Infrastructure Documentation

**User Story:** As a DevOps engineer, I want infrastructure documentation, so that I can manage Docker services and deploy to production.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `docker-architecture.md` file at the path `docs/infrastructure/docker-architecture.md` describing all Docker Compose services (postgres, api, worker, web), including each service's exposed ports, volume mounts, dependency order, and health check configuration
2. THE `docker-architecture.md` file SHALL describe internal Docker networking including how containers communicate via service names, specifying which service connects to which other service and on which internal port
3. THE `docker-architecture.md` file SHALL include an Environment_Variable_Table for each container service with columns for variable name, description, default value, and whether the variable is required or optional
4. THE `docker-architecture.md` file SHALL describe the multi-stage Dockerfile build pattern used by the application services, identifying each named stage (deps, build, prod-deps, runtime) and its purpose
5. THE Documentation_System SHALL provide a `gcp-deployment.md` file at the path `docs/infrastructure/gcp-deployment.md` describing VPS deployment procedures
6. THE `gcp-deployment.md` file SHALL describe domain routing and HTTPS configuration including the domain provider, DNS record type required, and how TLS certificates are provisioned
7. THE `gcp-deployment.md` file SHALL include a Deployment_Checklist for production deployments containing at minimum one step for each of the following phases: container image build, database migration, health verification, and rollback procedure

### Requirement 9: API Endpoints Documentation

**User Story:** As an API consumer or frontend developer, I want complete endpoint documentation, so that I can integrate with the ArcPass API correctly.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide an `endpoints.md` file located at `docs/api/endpoints.md` documenting all public API endpoints
2. THE `endpoints.md` file SHALL document each endpoint with HTTP method, full path (including prefix), one-sentence purpose description, request schema (headers, path parameters, query parameters, body with types), success response schema (status code and body with types), and error responses (status codes and conditions)
3. THE `endpoints.md` file SHALL include example request and response bodies for each endpoint (GET /health, POST /wallets/register, GET /wallets/:address, GET /wallets/:address/history, POST /sponsorship/request, GET /sponsorship/:id, GET /sponsorship/tx/:hash, GET /relay/:id)
4. THE `endpoints.md` file SHALL document validation rules including wallet address format (`^0x[0-9a-fA-F]{40}$`, exactly 42 characters), UUID format for ID parameters, transaction hash maximum length of 1024 characters, and pagination parameters (cursor as UUID, limit as integer between 1 and 100 with default of 50)
5. THE `endpoints.md` file SHALL document the standardized error response body structure containing an `error` field (string message) and a `statusCode` field (integer), and SHALL document HTTP status codes for each failure mode: 400 (validation error or invalid JSON), 403 (blocked wallet), 404 (resource not found), 429 (rate limited, includes Retry-After header), and 500 (internal server error)

### Requirement 10: Security Model Documentation

**User Story:** As a security engineer or auditor, I want a comprehensive security model document, so that I can evaluate the system's threat mitigations and trust boundaries.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `security-model.md` file in the `security` section containing the following named sections: Rate Limiting, Replay Protection, Wallet Restrictions, Trust Boundaries, and Hardening Measures
2. THE `security-model.md` file SHALL describe IP rate limiting with sliding-window counters specifying the default threshold (10 requests per window), the default window duration (3,600,000 ms), the default block duration (900,000 ms), and wallet rate limiting with a default threshold of 5 requests per window, noting that all thresholds are configurable via environment variables, and that exceeding the threshold triggers auto-block behavior returning HTTP 429 with a Retry-After header
3. THE `security-model.md` file SHALL describe replay protection using the 5-second deduplication window with a composite key of `{walletAddress}:{clientIp}` stored in the RateLimit table, specifying that duplicate POST /sponsorship/request submissions within the window are rejected with HTTP 429
4. THE `security-model.md` file SHALL describe wallet restriction mechanisms including the `isBlocked` flag on the Wallet model, eligibility validation at the API layer (pre-request check) and worker layer (rejection during processing with status transition to `rejected`), and the partial unique index enforcing one non-terminal sponsorship request per wallet
5. THE `security-model.md` file SHALL describe trust boundaries between components (client → API → database → worker → blockchain) specifying for each boundary: the transport mechanism, what validation occurs at the boundary, and what data crosses it
6. THE `security-model.md` file SHALL describe hardening measures with a subsection for each: security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Content-Security-Policy, Cache-Control, removal of X-Powered-By), frozen config objects via Object.freeze, correlation IDs (X-Request-ID generation and passthrough with 128-character maximum), graceful shutdown with a 10-second timeout, JSON Schema strictness with additionalProperties set to false, and row-level locking via SELECT FOR UPDATE SKIP LOCKED
7. WHEN a threat mitigation is described, THE `security-model.md` file SHALL identify the threat being mitigated, the mechanism used, and the observable system behavior when the threat is detected

### Requirement 11: Operations Runbooks

**User Story:** As an operations engineer, I want runbook documentation, so that I can perform routine maintenance and recover from failures using documented procedures.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `runbooks.md` file in the `operations` section containing operational procedures, where each procedure follows a consistent structure of: symptom description, diagnostic commands, resolution steps, and verification steps
2. THE `runbooks.md` file SHALL include a rebuild procedure for Docker containers (api, worker, web) with copy-pasteable shell commands covering image rebuild, container recreation, and startup confirmation
3. THE `runbooks.md` file SHALL include Docker troubleshooting procedures for each of the following failure scenarios: container crash loops, database connection failures, and health check failures, where each procedure includes at least one diagnostic command and one resolution action
4. THE `runbooks.md` file SHALL include health verification procedures that confirm operational status of each service (postgres, api, worker, web) by specifying the health check endpoint or command for each service and the expected success response
5. THE `runbooks.md` file SHALL include recovery procedures for: database connection or migration failures, sponsorship requests stuck in PENDING status beyond the configured poll interval, and worker process failures requiring restart
6. THE `runbooks.md` file SHALL include a deployment verification checklist with ordered steps confirming that postgres is accepting connections, api returns healthy from its `/health` endpoint, worker is polling and processing requests, and web is serving pages
7. WHEN describing resolution or recovery steps, THE `runbooks.md` file SHALL provide copy-pasteable shell commands using `docker compose` syntax consistent with the project's `docker-compose.yml` configuration

### Requirement 12: Technical Roadmap

**User Story:** As a stakeholder or contributor, I want a technical roadmap, so that I can understand completed milestones and planned future work.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `technical-roadmap.md` file located at the path `docs/roadmap/technical-roadmap.md` within the repository
2. THE `technical-roadmap.md` file SHALL contain a "Completed Milestones" section listing each completed milestone (API service, database foundation, wallet registry, sponsorship MVP, worker runtime, relay execution, Docker integration, production hardening, validation suite) with a name and a one-to-three sentence description of what was delivered
3. THE `technical-roadmap.md` file SHALL contain a "Planned: Infrastructure Stabilization" section listing at least 3 planned stabilization work items, each with a name and a one-sentence scope description
4. THE `technical-roadmap.md` file SHALL contain a "Planned: Integrations" section documenting Circle integration and paymaster patterns, each with a name and a one-sentence description of the integration purpose
5. THE `technical-roadmap.md` file SHALL contain a "Planned: SDK Development" section describing the `packages/sdk` plan with at least the target consumers, intended public surface area scope, and planned capabilities listed as bullet points
6. THE `technical-roadmap.md` file SHALL contain a "Production Readiness" section listing at least 5 measurable criteria (e.g., uptime target, test coverage threshold, security audit status) that must be satisfied before mainnet deployment
7. THE `technical-roadmap.md` file SHALL visually distinguish completed milestones from planned work items using explicit status labels ("Completed" or "Planned") or equivalent section-level grouping

### Requirement 13: Contributing Guidelines

**User Story:** As a contributor, I want development guidelines, so that I can write code that meets project standards and follows established conventions.

#### Acceptance Criteria

1. THE Documentation_System SHALL provide a `development-guidelines.md` file in the `contributing` section describing coding standards including TypeScript usage, modular function design, composition over large files, and avoidance of unnecessary dependencies
2. THE `development-guidelines.md` file SHALL describe architecture principles (modular design, service layer separation, no business logic in routes, isolated blockchain logic in `services/lib`, server-side validation preference)
3. THE `development-guidelines.md` file SHALL describe monorepo rules (shared logic in `packages/shared`, workspace dependency management via pnpm workspaces, Turborepo build orchestration with `dependsOn: ["^build"]` task ordering)
4. THE `development-guidelines.md` file SHALL describe commit conventions using a type-prefixed format (feat, fix, chore, docs, refactor, test) and branch naming patterns using a category prefix followed by a slash and descriptive slug (e.g., `feature/`, `fix/`, `docs/`, `chore/`)
5. THE `development-guidelines.md` file SHALL describe documentation conventions for maintaining the `/docs` directory including Mintlify-compatible YAML frontmatter on every page, relative-path Cross_Links between pages, and Mermaid code block syntax for diagrams
6. THE `development-guidelines.md` file SHALL describe testing expectations including running `pnpm validate` before submitting changes and ensuring no regressions in the validation suite

### Requirement 14: Mintlify Compatibility

**User Story:** As a documentation maintainer, I want all documentation formatted for Mintlify compatibility, so that migration to hosted documentation requires minimal rework.

#### Acceptance Criteria

1. WHEN a documentation page is created, THE Documentation_System SHALL include YAML frontmatter containing a `title` field (maximum 60 characters) and a `description` field (maximum 160 characters)
2. THE Documentation_System SHALL use Mintlify-supported Markdown syntax including headings (h1–h4), fenced code blocks with language identifiers, GFM tables, and callout blocks using Mintlify component syntax (`<Note>`, `<Warning>`, `<Info>`, `<Tip>`)
3. THE Documentation_System SHALL use relative paths for all Cross_Links between documentation pages
4. IF a Cross_Link references a documentation page that does not exist, THEN THE Documentation_System SHALL report the broken link as a validation error identifying the source page and the invalid path
5. THE Documentation_System SHALL use Mermaid code blocks (` ```mermaid `) for all architectural and sequence diagrams

### Requirement 15: Content Accuracy

**User Story:** As a documentation reader, I want all content to reflect the actual repository state, so that I can trust the documentation as a reliable reference.

#### Acceptance Criteria

1. THE Documentation_System SHALL reference only function names, route paths, configuration keys, CLI commands, and file paths that exist in the current repository at the time of publication
2. THE Documentation_System SHALL contain no placeholder text, lorem ipsum content, or TODO markers in published pages
3. WHEN describing API endpoints, THE Documentation_System SHALL list the same HTTP method, route path, request parameters, and response fields as defined in the corresponding route handler source files
4. WHEN describing environment variables, THE Documentation_System SHALL list the same variable names and default values as defined in `.env.example` files at the repository root and within each package or app directory, and in `docker-compose.yml` service environment blocks
5. WHEN describing database models, THE Documentation_System SHALL list the same model names, field names, field types, relations, and enum values as defined in `packages/shared/prisma/schema.prisma`
6. WHEN source code is modified in a way that changes a documented API endpoint, environment variable, or database model, THE Documentation_System SHALL be updated in the same changeset or flagged as out-of-date within the pull request review
