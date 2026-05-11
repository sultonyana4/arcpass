# Implementation Plan: Documentation System

## Overview

Create a comprehensive professional documentation system for the ArcPass monorepo as structured Markdown files in the `/docs` directory. Each file uses Mintlify-compatible frontmatter, Mermaid diagrams, and relative cross-links. A structural validation test ensures ongoing correctness.

## Tasks

- [x] 1. Create documentation directory structure and index page
  - [x] 1.1 Create the `/docs` directory tree with all 11 section directories and the root `index.md` landing page
    - Create directories: `getting-started`, `architecture`, `backend`, `frontend`, `contracts`, `infrastructure`, `api`, `security`, `operations`, `roadmap`, `contributing`
    - Write `docs/index.md` with Mintlify frontmatter (`title` ≤60 chars, `description` ≤160 chars), project overview, vision statement, core goals, high-level Mermaid architecture diagram (Frontend → API → PostgreSQL → Worker → Smart Contracts), and navigation links to all 11 sections using relative paths
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 14.1, 14.3_

- [x] 2. Create Getting Started documentation
  - [x] 2.1 Create `docs/getting-started/installation.md`
    - Include Mintlify frontmatter
    - Prerequisites section with version-check commands (Node.js 22+, pnpm 10.33+, Docker, Foundry)
    - Docker setup steps (≥4 numbered steps): container startup, Prisma generate, migration, service launch
    - Environment variable table (≥6 required, ≥10 optional) sourced from `.env.example` and `docker-compose.yml`
    - Development workflow commands: `pnpm dev`, `pnpm validate`, `pnpm db:up/down/generate/migrate/reset`
    - Verification section with observable success indicator
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 14.1, 14.5, 15.1, 15.4_

  - [x] 2.2 Create `docs/getting-started/project-structure.md`
    - Include Mintlify frontmatter
    - Workspace responsibility descriptions (apps/api, apps/worker, apps/web, packages/shared, packages/sdk, packages/ui, contracts) with one-sentence summary per workspace
    - Mermaid diagram showing runtime relationships between workspaces (API, Worker, PostgreSQL, Arc Network nodes with labeled edges)
    - _Requirements: 3.6, 3.7, 3.8, 14.1, 14.5_

- [x] 3. Create Architecture documentation
  - [x] 3.1 Create `docs/architecture/system-overview.md`
    - Include Mintlify frontmatter
    - Full request flow description: client → Fastify API (validation, rate limiting, replay protection) → PostgreSQL → Worker → SponsorVault → confirmation
    - Docker networking Mermaid diagram with all containers (postgres, api, worker, web), ports, and dependencies
    - Next.js API proxy pattern description (browser → Next.js server-side route → Fastify backend)
    - Sponsorship lifecycle state machine (pending → approved → relayed → completed | failed | rejected) with valid transitions
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 14.1, 14.5, 15.1_

  - [x] 3.2 Create `docs/architecture/runtime-flow.md`
    - Include Mintlify frontmatter
    - Wallet registration Mermaid sequence diagram (Client, Fastify API, PostgreSQL) including validation failure responses
    - Sponsorship execution Mermaid sequence diagram (Poller, Processor, PostgreSQL, Relay Executor, Arc Network) covering poll → lock → status transitions → relay → receipt, including failure/retry branch
    - Worker operational mechanics: poll interval (POLL_INTERVAL_MS), batch size (BATCH_SIZE), row-level locking (SELECT FOR UPDATE SKIP LOCKED), stale-relayed recovery, graceful shutdown (SIGTERM/SIGINT with bounded drain timeout), chain ID verification at startup
    - _Requirements: 4.5, 4.6, 4.7, 4.8, 14.1, 14.5, 15.1_

- [x] 4. Create Backend documentation
  - [x] 4.1 Create `docs/backend/api-architecture.md`
    - Include Mintlify frontmatter
    - Fastify 5.x plugin architecture with ordered registration sequence (CORS → security headers → correlation ID → content-type check → replay protection → error handler → routes → not-found handler) with one-sentence purpose per plugin
    - JSON Schema validation approach with `additionalProperties: false` and field-level error messages
    - Error handling strategy: custom error classes (ValidationError, BlockedWalletError, WalletNotFoundError, SponsorshipNotFoundError, RateLimitError, InvalidStatusTransitionError), HTTP status codes, structured response shape
    - Service layer pattern: routes/ → services/ → lib/ with delegation flow example
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 14.1, 14.2, 15.1, 15.3_

  - [x] 4.2 Create `docs/backend/database.md`
    - Include Mintlify frontmatter
    - Prisma ORM usage: schema location (`packages/shared/prisma/schema.prisma`), client generation, migration workflow
    - Status transitions: SponsorshipRequest (pending → approved → relayed → completed | failed | rejected), RelayTransaction (queued → submitted → confirmed | failed)
    - Mermaid ER diagram showing model relationships (Wallet → SponsorshipRequest → RelayTransaction, standalone RateLimit) with indexed columns
    - _Requirements: 5.6, 5.7, 5.8, 5.9, 14.1, 14.5, 15.1, 15.5_

- [x] 5. Checkpoint - Verify core documentation structure
  - Ensure all files created so far have valid Mintlify frontmatter, no placeholder content, and correct cross-links. Ask the user if questions arise.

- [x] 6. Create Frontend and Contracts documentation
  - [x] 6.1 Create `docs/frontend/frontend-architecture.md`
    - Include Mintlify frontmatter
    - Next.js 16 App Router architecture with `app/` directory, page routes vs API route handlers
    - Client/server component boundary (server components for data fetching, client components for interactive UI with hooks)
    - API proxy pattern: catch-all route at `app/api/backend/[...path]/route.ts` → `API_URL_INTERNAL`, client-side relative path `/api/backend`
    - State management: React hooks, centralized API client (`lib/api-client.ts`), env config (`config/env.ts`), `router.refresh()`
    - Infrastructure dashboard page functionality (health status of API, PostgreSQL, Worker, RPC)
    - Directory conventions: `components/ui/`, `components/features/`, `components/layout/`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 14.1, 15.1_

  - [x] 6.2 Create `docs/contracts/contracts-overview.md`
    - Include Mintlify frontmatter
    - SponsorVault and SponsorshipRegistry contract descriptions (purpose, public functions, access restrictions, events)
    - Owner/operator authorization model (owner-only vs operator-only functions)
    - Relay assumptions: checks-effects-interactions pattern, AlreadySponsored guard
    - Security mechanisms: per-transaction limit, emergency withdrawal, immutable vault address, vault-only write
    - Mermaid diagram showing contract interaction flow for sponsorTransfer (SponsorVault, SponsorshipRegistry, recipient)
    - Deployment process (4 phases): deploy SponsorVault → deploy SponsorshipRegistry → initializeRegistry → validate
    - Two-phase initialization pattern for circular dependency
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 14.1, 14.5, 15.1_

- [x] 7. Create Infrastructure documentation
  - [x] 7.1 Create `docs/infrastructure/docker-architecture.md`
    - Include Mintlify frontmatter
    - All Docker Compose services (postgres, api, worker, web) with exposed ports, volume mounts, dependency order, health checks
    - Internal Docker networking (service-name resolution, which service connects to which)
    - Environment variable table per service (name, description, default, required/optional)
    - Multi-stage Dockerfile build pattern (deps → build → prod-deps → runtime)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 14.1, 15.1, 15.4_

  - [x] 7.2 Create `docs/infrastructure/gcp-deployment.md`
    - Include Mintlify frontmatter
    - VPS deployment procedures
    - Domain routing and HTTPS/TLS configuration (domain provider, DNS record type, certificate provisioning)
    - Deployment checklist: image build → database migration → health verification → rollback procedure
    - _Requirements: 8.5, 8.6, 8.7, 14.1_

- [x] 8. Create API Endpoints documentation
  - [x] 8.1 Create `docs/api/endpoints.md`
    - Include Mintlify frontmatter
    - Document all endpoints: GET /health, POST /wallets/register, GET /wallets/:address, GET /wallets/:address/history, POST /sponsorship/request, GET /sponsorship/:id, GET /sponsorship/tx/:hash, GET /relay/:id
    - Each endpoint with: HTTP method, full path, purpose, request schema (headers, params, query, body with types), success response (status code + body), error responses (codes + conditions)
    - Example request and response bodies for each endpoint
    - Validation rules: wallet address pattern (`^0x[0-9a-fA-F]{40}$`), UUID format, tx hash max 1024 chars, pagination (cursor UUID, limit 1–100, default 50)
    - Standardized error response structure (`{ error: string, statusCode: number }`) and HTTP status codes per failure mode (400, 403, 404, 429, 500)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 14.1, 14.2, 15.1, 15.3_

- [x] 9. Create Security Model documentation
  - [x] 9.1 Create `docs/security/security-model.md`
    - Include Mintlify frontmatter
    - Sections: Rate Limiting, Replay Protection, Wallet Restrictions, Trust Boundaries, Hardening Measures
    - Rate limiting: IP (10 req/window, 3600000ms window, 900000ms block), wallet (5 req/window), auto-block with HTTP 429 + Retry-After
    - Replay protection: 5s deduplication window, composite key `{walletAddress}:{clientIp}`, HTTP 429 on duplicate
    - Wallet restrictions: `isBlocked` flag, eligibility checks at API and worker layers, partial unique index
    - Trust boundaries: client → API → database → worker → blockchain with transport, validation, and data crossing per boundary
    - Hardening measures: security headers, frozen config objects, correlation IDs (128-char max), graceful shutdown (10s timeout), JSON Schema strictness, row-level locking
    - Each threat mitigation identifies: threat, mechanism, observable behavior when detected
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 14.1, 15.1_

- [x] 10. Checkpoint - Verify documentation completeness
  - Ensure all files created so far have valid Mintlify frontmatter, no placeholder content, correct cross-links, and accurate references to source code. Ask the user if questions arise.

- [x] 11. Create Operations, Roadmap, and Contributing documentation
  - [x] 11.1 Create `docs/operations/runbooks.md`
    - Include Mintlify frontmatter
    - Consistent structure per procedure: symptom → diagnostic commands → resolution steps → verification
    - Docker rebuild procedure with copy-pasteable `docker compose` commands
    - Troubleshooting: container crash loops, database connection failures, health check failures (each with diagnostic command + resolution)
    - Health verification per service (postgres, api, worker, web) with health check endpoint/command and expected response
    - Recovery procedures: DB migration failures, stuck PENDING requests, worker restart
    - Deployment verification checklist (postgres accepting connections, api /health, worker polling, web serving)
    - All commands use `docker compose` syntax consistent with project's `docker-compose.yml`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 14.1, 15.1_

  - [x] 11.2 Create `docs/roadmap/technical-roadmap.md`
    - Include Mintlify frontmatter
    - Completed Milestones section: API service, database foundation, wallet registry, sponsorship MVP, worker runtime, relay execution, Docker integration, production hardening, validation suite (name + 1–3 sentence description each)
    - Planned: Infrastructure Stabilization (≥3 items with name + scope)
    - Planned: Integrations (Circle, paymaster patterns)
    - Planned: SDK Development (target consumers, public surface, capabilities)
    - Production Readiness section (≥5 measurable criteria for mainnet deployment)
    - Visual distinction between completed and planned items (status labels or section grouping)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 14.1_

  - [x] 11.3 Create `docs/contributing/development-guidelines.md`
    - Include Mintlify frontmatter
    - Coding standards: TypeScript, modular functions, composition, minimal dependencies
    - Architecture principles: service layer separation, no business logic in routes, isolated blockchain logic, server-side validation
    - Monorepo rules: shared logic in packages/shared, pnpm workspaces, Turborepo `dependsOn: ["^build"]`
    - Commit conventions: type-prefixed (feat, fix, chore, docs, refactor, test), branch naming (feature/, fix/, docs/, chore/)
    - Documentation conventions: Mintlify frontmatter, relative cross-links, Mermaid diagrams
    - Testing expectations: `pnpm validate` before submitting, no regressions
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.1_

- [x] 12. Create structural validation test
  - [x] 12.1 Create `tests/validation/docs.validation.test.ts` to validate documentation structure
    - Verify all 11 section directories exist under `/docs`
    - Verify each section contains at least one `.md` file with lowercase kebab-case naming
    - Verify all `.md` files have valid YAML frontmatter with `title` (≤60 chars) and `description` (≤160 chars)
    - Verify `docs/index.md` exists and contains links to all sections
    - Verify no files contain `TODO`, `lorem ipsum`, or placeholder markers
    - Verify all relative cross-links resolve to existing files
    - Verify no broken internal links
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 14.1, 14.3, 14.4, 15.2_

- [x] 13. Final checkpoint - Full documentation validation
  - Run `pnpm validate` to ensure the new validation test passes alongside existing tests. Ensure all documentation files are complete, cross-linked, and free of placeholder content. Ask the user if questions arise.

## Notes

- No property-based tests are included — the design explicitly states PBT does not apply to static documentation content
- The validation test (task 12.1) provides automated structural verification as part of the existing `pnpm validate` suite
- All documentation content must be derived from actual source code (routes, schemas, env files, docker-compose.yml)
- Each Markdown file must include Mintlify-compatible YAML frontmatter
- All diagrams use Mermaid code blocks for GitHub and Mintlify rendering
- All cross-links use relative paths between documentation pages
- Checkpoints ensure incremental validation of documentation quality

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2"] },
    { "id": 2, "tasks": ["4.1", "4.2", "6.1", "6.2"] },
    { "id": 3, "tasks": ["7.1", "7.2", "8.1", "9.1"] },
    { "id": 4, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 5, "tasks": ["12.1"] }
  ]
}
```
