# ArcPass

Public onboarding infrastructure for Arc Network. ArcPass solves the cold-start gas problem by sponsoring the first transaction for eligible wallets through a relay execution pipeline backed by on-chain smart contracts, a Fastify API, and an autonomous worker runtime.

---

## Core Capabilities

- Wallet registration and eligibility verification
- Sponsored native-token transfers via on-chain SponsorVault
- Full transaction lifecycle tracking (pending → approved → relayed → completed)
- Relay execution with retry, timeout, and stale-recovery semantics
- Row-level locking for concurrent worker safety
- IP and wallet rate limiting with sliding-window auto-block
- Replay protection (5-second deduplication window)
- On-chain sponsorship accounting via SponsorshipRegistry
- Chain ID verification at startup
- Graceful shutdown with configurable timeout
- Multi-stage Docker builds with automatic migration on boot

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ArcPass Infrastructure                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────┐         ┌──────────────────┐         ┌───────────┐  │
│   │   Client     │──POST──▶│   Fastify API    │──write─▶│PostgreSQL │  │
│   │  (wallet)    │◀──JSON──│   (apps/api)     │◀──read──│  (Prisma) │  │
│   └──────────────┘         └──────────────────┘         └─────┬─────┘  │
│                                   │                           │         │
│                            security headers                   │         │
│                            rate limiting                      │         │
│                            replay protection                  │         │
│                            schema validation                  │         │
│                                                               │         │
│   ┌──────────────────────────────────────────────────────────┐│         │
│   │                  Worker Runtime (apps/worker)             ││         │
│   │                                                          ││         │
│   │  ┌────────┐    ┌───────────┐    ┌────────────────────┐  ││         │
│   │  │ Poller │───▶│ Processor │───▶│  Relay Executor    │  │◀─────────┘
│   │  └────────┘    └───────────┘    └─────────┬──────────┘  │          │
│   │       │              │                    │              │          │
│   │  poll cycle    row-level lock        viem clients        │          │
│   │  (setTimeout)  (SKIP LOCKED)         AbortController     │          │
│   │                                           │              │          │
│   └───────────────────────────────────────────┼──────────────┘          │
│                                               │                         │
│   ┌───────────────────────────────────────────▼──────────────────────┐  │
│   │                    Arc Network (Testnet)                          │  │
│   │                                                                  │  │
│   │   ┌─────────────────┐          ┌────────────────────────┐       │  │
│   │   │  SponsorVault   │─────────▶│  SponsorshipRegistry   │       │  │
│   │   │  (treasury +    │  record  │  (on-chain accounting) │       │  │
│   │   │   transfers)    │          │                        │       │  │
│   │   └─────────────────┘          └────────────────────────┘       │  │
│   │                                                                  │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Fastify API

Stateless HTTP service handling wallet registration, sponsorship requests, and status queries. Structured as a plugin architecture with ordered registration: CORS → security headers → correlation ID → content-type validation → replay protection → error handling. Routes delegate to service modules; no business logic in route handlers.

### Worker Runtime

Autonomous background process that polls PostgreSQL for pending and stale-relayed sponsorship requests. Acquires exclusive row-level locks via `SELECT FOR UPDATE SKIP LOCKED` to prevent double-processing across instances. Transitions requests through the full lifecycle within a single database transaction, then invokes the relay executor for on-chain settlement.

### PostgreSQL Persistence

Prisma ORM over PostgreSQL 16. Schema includes Wallet, SponsorshipRequest, RelayTransaction, and RateLimit models with enum-based status fields, indexed foreign keys, and composite indexes for query performance.

### Relay Execution Flow

1. Poller discovers processable requests (pending or stale-relayed)
2. Processor acquires row lock and validates eligibility
3. Status transitions: pending → approved → relayed
4. RelayTransaction created (queued → submitted)
5. Contract client calls `SponsorVault.sponsorTransfer` via viem
6. Receipt awaited with configurable timeout (AbortController)
7. SponsorshipGranted event extracted from logs
8. On success: relay confirmed, sponsorship completed, wallet count incremented
9. On failure: relay marked failed, retryable up to MAX_RETRIES
10. AlreadySponsored revert treated as idempotent success

### Sponsorship Validation

Enforced at both API and worker layers:
- Wallet must exist and not be blocked
- No duplicate pending requests per wallet
- Valid status transitions enforced via shared transition map
- Retry count bounded by configuration
- Chain ID verified against RPC at worker startup

### Replay Protection

POST requests to `/sponsorship/request` are deduplicated using a composite key of `walletAddress:clientIp` with a 5-second sliding window stored in the RateLimit table.

### Runtime Validation Suite

Dedicated validation test suite (`tests/validation/`) verifying environment configuration, database schema integrity, API behavior, worker lifecycle, hardening properties, receipt handling, poller mechanics, contract integration, and end-to-end execution flow. Runs with a custom sequencer in a single fork.

---

## Monorepo Structure

```
arcpass/
├── apps/
│   ├── api/              Fastify sponsorship API (routes, plugins, services)
│   ├── worker/           Relay worker runtime (poller, processor, contract client)
│   └── web/              Public onboarding frontend (Next.js)
├── packages/
│   └── shared/           Prisma schema, DB client, sponsorship types, transitions
├── contracts/            Solidity smart contracts (Foundry)
│   ├── src/              SponsorVault, SponsorshipRegistry, ISponsorshipRegistry
│   └── script/           Deployment script (Deploy.s.sol)
├── tests/
│   └── validation/       Runtime validation test suite
├── .kiro/
│   └── specs/            Feature specifications (12 specs)
├── docker-compose.yml    PostgreSQL + worker services
├── turbo.json            Turborepo build orchestration
└── package.json          Workspace root (pnpm)
```

### apps/api

Fastify 5.x REST API. Plugin-based architecture with ordered middleware registration. Handles wallet registration, sponsorship request creation, status queries, and relay transaction lookups. Rate limiting at both IP and wallet granularity with auto-block on threshold breach.

### apps/worker

TypeScript worker compiled to ES modules. Initializes viem clients, verifies chain ID against RPC, configures contract client with ABI bindings, and starts a poll loop. Each cycle queries for work, processes requests sequentially with row-level locking, and executes on-chain relay transactions. Supports graceful shutdown with force-exit timeout.

### packages/shared

Single source of truth for database access and sponsorship domain types. Exports the Prisma client, connection validation utilities, status enums, valid transition maps, and payload type definitions consumed by both API and worker.

### tests/validation

Integration-level validation suite covering environment configuration, database schema, API endpoints, worker lifecycle, production hardening, receipt handling, poller behavior, contract integration, and end-to-end sponsored execution. Uses Vitest with a custom sequencer.

### .kiro/specs

Feature specifications documenting the design and implementation of each system component: API service initialization, database foundation, wallet registry, sponsorship platform MVP, worker runtime, real relay execution, Docker integration, production hardening, runtime validation, and end-to-end sponsored execution.

---

## System Components

| Component | Technology | Role |
|-----------|-----------|------|
| API | Fastify 5, Node.js | HTTP interface for wallet and sponsorship operations |
| Worker | TypeScript, viem | Background relay execution and lifecycle management |
| Database | PostgreSQL 16, Prisma | Persistence, locking, state machine storage |
| Contracts | Solidity 0.8.20, Foundry | On-chain treasury and sponsorship accounting |
| Build | Turborepo, pnpm | Monorepo orchestration and dependency management |
| Runtime | Docker, Node 22 Alpine | Containerized deployment with migration-on-boot |

---

## Transaction Lifecycle

```
                    ┌─────────┐
                    │ pending │ ← API creates request
                    └────┬────┘
                         │ worker acquires lock
                    ┌────▼────┐
                    │approved │
                    └────┬────┘
                         │ relay TX created
                    ┌────▼────┐
                    │ relayed │ ← on-chain TX broadcast
                    └────┬────┘
                    ┌────┴────┐
               ┌────▼────┐ ┌──▼───┐
               │completed│ │failed│ ← retryable up to MAX_RETRIES
               └─────────┘ └──────┘
```

Rejected requests (blocked wallet) branch directly from pending. Terminal states (completed, failed, rejected) have no outbound transitions.

---

## Security and Hardening

- **Rate limiting**: Sliding-window counters per IP and per wallet with configurable thresholds and auto-block duration
- **Replay protection**: 5-second deduplication window on sponsorship requests (wallet+IP composite key)
- **Security headers**: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Content-Security-Policy, Cache-Control, conditional HSTS
- **Row-level locking**: `SELECT FOR UPDATE SKIP LOCKED` prevents concurrent processing of the same request
- **Input validation**: JSON Schema with strict `additionalProperties: false` on all request bodies
- **Correlation IDs**: Request tracing across API and worker logs
- **Config immutability**: Frozen configuration objects prevent runtime mutation
- **Sensitive data handling**: Private keys validated cryptographically but never logged; only variable names appear in error output
- **Graceful shutdown**: SIGTERM/SIGINT handlers with bounded drain timeout and force-exit fallback
- **Chain verification**: Worker validates chain ID against RPC endpoint before processing
- **Contract safety**: Checks-effects-interactions pattern, per-transaction limits, AlreadySponsored guard, emergency withdrawal

---

## Validation and Testing

```bash
# Run the runtime validation suite
pnpm validate

# Run API unit tests
pnpm --filter @arcpass/api test

# Run worker unit tests
pnpm --filter @arcpass/worker test

# Run shared package tests
pnpm --filter @arcpass/shared test

# Build smart contracts
cd contracts && forge build

# Run contract tests
cd contracts && forge test
```

The validation suite covers:
- Environment variable loading and format validation
- Database schema integrity and migration state
- API route behavior and error responses
- Worker lifecycle transitions and retry semantics
- Production hardening (headers, rate limits, replay)
- Receipt handling and event extraction
- Poller mechanics and batch processing
- Contract client integration
- End-to-end sponsored execution flow

---

## Local Development Setup

### Prerequisites

- Node.js 22+
- pnpm 10.33+
- Docker and Docker Compose
- Foundry (for smart contract development)

### Quick Start

```bash
# Install dependencies
pnpm install

# Start PostgreSQL
pnpm db:up

# Generate Prisma client
pnpm db:generate

# Run database migrations
pnpm db:migrate

# Start all services in development mode
pnpm dev
```

### Database Commands

```bash
pnpm db:up          # Start PostgreSQL container
pnpm db:down        # Stop PostgreSQL container
pnpm db:generate    # Regenerate Prisma client
pnpm db:migrate     # Apply pending migrations
pnpm db:reset       # Reset database (destructive)
pnpm db:studio      # Open Prisma Studio
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `CHAIN_RPC_URL` | Worker | — | Arc network RPC endpoint |
| `SPONSOR_PRIVATE_KEY` | Worker | — | Relay operator private key (64 hex chars) |
| `CHAIN_ID` | Worker | — | Target chain ID for RPC verification |
| `CONTRACT_ADDRESS_SPONSOR_VAULT` | Worker | — | Deployed SponsorVault address |
| `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY` | Worker | — | Deployed SponsorshipRegistry address |
| `SPONSORSHIP_AMOUNT_WEI` | No | `1000000000000000` | Native tokens per sponsorship (wei) |
| `PORT` | No | `4000` | API listen port |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `POLL_INTERVAL_MS` | No | `5000` | Worker poll cycle interval |
| `BATCH_SIZE` | No | `20` | Max requests per poll cycle |
| `MAX_RETRIES` | No | `5` | Max relay attempts per request |
| `LOCK_TIMEOUT_MS` | No | `30000` | Database transaction timeout |
| `TX_TIMEOUT_MS` | No | `120000` | On-chain TX confirmation timeout |
| `CONFIRMATION_BLOCKS` | No | `2` | Blocks to wait for confirmation |
| `CORS_ALLOWED_ORIGINS` | No | — | Comma-separated allowed origins |
| `RATE_LIMIT_IP_MAX` | No | `10` | Max requests per IP per window |
| `RATE_LIMIT_WALLET_MAX` | No | `5` | Max requests per wallet per window |
| `RATE_LIMIT_WINDOW_MS` | No | `3600000` | Rate limit window duration |
| `RATE_LIMIT_BLOCK_DURATION_MS` | No | `900000` | Auto-block duration |

See `.env.example` for the full template.

---

## Docker Support

### Development (PostgreSQL only)

```bash
docker compose up -d postgres
```

### Full Stack (PostgreSQL + Worker)

```bash
docker compose up -d
```

The worker container:
- Builds via multi-stage Dockerfile (deps → build → runtime)
- Runs `prisma migrate deploy` on startup before processing
- Uses Node 22 Alpine as the runtime base
- Installs only production dependencies in the final image
- Restarts automatically unless explicitly stopped

---

## Arc Network Integration

ArcPass targets the Arc testnet (chain ID `1942999`). The worker verifies the chain ID against the configured RPC endpoint at startup and terminates on mismatch.

### Smart Contracts

Two contracts form the on-chain layer:

**SponsorVault** — Holds native token treasury and executes authorized transfers. Owner/operator access control separates configuration from execution. Per-transaction limits cap individual sponsorship amounts. Emergency withdrawal provides a safety valve.

**SponsorshipRegistry** — Immutable on-chain accounting. Only the vault can record sponsorships. Emits `SponsorshipGranted` events consumed by the worker for receipt verification. Provides `isSponsored()` and `sponsorshipCount()` view functions for external verification.

### Deployment

Contracts deploy via a deterministic 4-phase Foundry script:

1. Deploy SponsorVault (operator address, per-tx limit)
2. Deploy SponsorshipRegistry (vault address, immutable)
3. Initialize registry in vault (one-time, owner-only)
4. Validate deployment integrity (ownership, linkage, limits)

```bash
cd contracts
source .env
forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL --broadcast -vvvv
```

---

## Repository Status

**Current state**: MVP implementation complete. API, worker, smart contracts, Docker integration, and validation suite are operational.

**Implemented**:
- Wallet registration and eligibility
- Sponsored transaction relay with on-chain settlement
- Full lifecycle state machine with retry semantics
- Rate limiting and replay protection
- Production hardening (security headers, graceful shutdown, config validation)
- Runtime validation suite
- Docker containerization with migration-on-boot
- Smart contract deployment pipeline

**Roadmap**:
- Developer SDK (`packages/sdk`)
- Public frontend integration (`apps/web`)
- Mainnet contract deployment
- Monitoring and alerting integration
- Horizontal worker scaling

---

## Public Good Positioning

ArcPass is onboarding infrastructure for the Arc ecosystem. It removes the cold-start barrier for new wallets by absorbing the cost of the first transaction, enabling frictionless entry into the network without requiring users to acquire gas independently.

The system is designed as shared public infrastructure:
- Open-source and auditable
- No token, no governance overhead
- Deterministic sponsorship logic with on-chain verification
- Operator-neutral — any authorized relay can execute sponsorships
- Bounded resource consumption via per-transaction limits and rate controls

ArcPass serves the same role for Arc that gas station networks serve for Ethereum: a coordination layer that subsidizes onboarding to reduce friction and accelerate ecosystem adoption.

---

## License

MIT
