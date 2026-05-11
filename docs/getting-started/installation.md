---
title: "Installation & Local Development"
description: "Set up the ArcPass monorepo for local development with Docker, PostgreSQL, and all required services."
---

# Installation & Local Development

This guide walks you through setting up the ArcPass monorepo for local development. By the end, you will have all services running and verified.

## Prerequisites

Ensure the following tools are installed and meet the minimum version requirements:

| Tool | Minimum Version | Version Check Command |
|------|----------------|----------------------|
| Node.js | 22+ | `node --version` |
| pnpm | 10.33+ | `pnpm --version` |
| Docker | Latest stable | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |
| Foundry (forge) | Latest | `forge --version` |

<Note>The project uses `pnpm@10.33.0` as its package manager, specified in the root `package.json` via the `packageManager` field. Corepack will auto-install the correct version if enabled (`corepack enable`).</Note>

## Clone and Install Dependencies

```bash
git clone <repository-url> arcpass
cd arcpass
pnpm install
```

## Docker Setup

The project uses Docker Compose to run PostgreSQL and all application services. Follow these steps to get the full stack running:

1. **Start the PostgreSQL container**

   ```bash
   pnpm db:up
   ```

   This runs `docker compose up -d`, starting the PostgreSQL 16 Alpine container on port `5433` (mapped to internal `5432`). Wait for the health check to pass before proceeding.

2. **Generate the Prisma client**

   ```bash
   pnpm db:generate
   ```

   This generates the Prisma client from the schema at `packages/shared/prisma/schema.prisma`, making the typed database client available to all consuming packages.

3. **Run database migrations**

   ```bash
   pnpm db:migrate
   ```

   This applies all pending Prisma migrations to the local PostgreSQL database, creating the required tables (Wallet, SponsorshipRequest, RelayTransaction, RateLimit).

4. **Launch all services**

   ```bash
   docker compose up -d
   ```

   This starts the full stack: PostgreSQL, API (port 4000), Worker, and Web (port 3000). Services start in dependency order — PostgreSQL must be healthy before the API starts, and the API must be healthy before the Web frontend starts.

5. **Verify all containers are running**

   ```bash
   docker compose ps
   ```

   All services should show a `healthy` or `running` status.

<Tip>For development without Docker for the application services, you can run just the database with `pnpm db:up` and then start services individually with `pnpm dev`.</Tip>

## Environment Variables

ArcPass uses environment variables for all configuration. Copy the example file to get started:

```bash
cp .env.example .env
```

### Required Variables

These variables must be set for the system to function:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | none | PostgreSQL connection string in the format `postgresql://user:password@host:port/database?schema=public` |
| `CHAIN_RPC_URL` | none | RPC endpoint URL for the Arc network, used by the worker for on-chain relay |
| `SPONSOR_PRIVATE_KEY` | none | Relay operator private key (64 hex characters, with or without `0x` prefix) |
| `CONTRACT_ADDRESS_SPONSOR_VAULT` | none | Deployed SponsorVault contract address on the target chain |
| `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY` | none | Deployed SponsorshipRegistry contract address on the target chain |
| `CHAIN_ID` | `5042002` | Chain ID for RPC verification at worker startup |

### Optional Variables

These variables have sensible defaults and can be tuned as needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MS` | `5000` | Worker polling interval in milliseconds for picking up pending sponsorship requests |
| `BATCH_SIZE` | `20` | Maximum number of sponsorship requests the worker processes per poll cycle |
| `MAX_RETRIES` | `5` | Maximum retry attempts for failed relay transactions before marking as permanently failed |
| `LOCK_TIMEOUT_MS` | `30000` | Timeout in milliseconds for row-level database locks during worker processing |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Grace period in milliseconds for the worker to drain in-flight work on SIGTERM/SIGINT |
| `TX_TIMEOUT_MS` | `120000` | Timeout in milliseconds for on-chain transaction confirmation |
| `CONFIRMATION_BLOCKS` | `2` | Number of block confirmations required before marking a relay transaction as confirmed |
| `SPONSORSHIP_AMOUNT_WEI` | `1000000000000000` | Amount of native token (in wei) transferred per sponsored transaction |
| `CHAIN_ID_VERIFY_TIMEOUT_MS` | `10000` | Timeout for chain ID verification RPC call at worker startup |
| `EXPLORER_BASE_URL` | `https://testnet.arcscan.app/tx/` | Base URL for the block explorer, used to generate transaction links |
| `PORT` | `4000` | Port the API service listens on |
| `NODE_ENV` | `production` | Node environment (`production`, `development`) |
| `LOG_LEVEL` | `info` | Logging verbosity level for the API service |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated list of allowed CORS origins for the API |
| `API_URL_INTERNAL` | `http://api:4000` | Internal service-to-service URL used by the web frontend to proxy API requests |
| `NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS` | none | SponsorVault address exposed to the frontend at build time |
| `NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS` | none | SponsorshipRegistry address exposed to the frontend at build time |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://testnet.arcscan.app/tx/` | Block explorer URL exposed to the frontend for transaction links |

<Note>Legacy aliases `ARC_RPC_URL` (fallback for `CHAIN_RPC_URL`) and `DEPLOYER_PRIVATE_KEY` (fallback for `SPONSOR_PRIVATE_KEY`) are supported for backward compatibility.</Note>

## Development Workflow Commands

The root `package.json` provides these workspace-level commands via Turborepo:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services in development mode (runs `turbo run dev` across workspaces) |
| `pnpm build` | Build all packages and applications |
| `pnpm validate` | Run the full validation test suite (`vitest --run`) |

### Database Operations

| Command | Description |
|---------|-------------|
| `pnpm db:up` | Start the PostgreSQL container (`docker compose up -d`) |
| `pnpm db:down` | Stop and remove Docker containers (`docker compose down`) |
| `pnpm db:generate` | Generate the Prisma client from the schema |
| `pnpm db:migrate` | Apply pending database migrations in development mode |
| `pnpm db:reset` | Reset the database — drops all data and re-applies migrations |
| `pnpm db:studio` | Open Prisma Studio for visual database browsing |

<Warning>Running `pnpm db:reset` will destroy all local data. Use it only when you need a clean slate.</Warning>

## Verification

After completing the setup, verify everything is working:

```bash
# 1. Check that all Docker containers are healthy
docker compose ps

# 2. Verify the API is responding
curl http://localhost:4000/health

# 3. Run the validation suite
pnpm validate
```

**Success indicator**: The API health endpoint returns a JSON response with a `200` status code:

```bash
$ curl -s http://localhost:4000/health | head
{"status":"ok"}
```

If the health check returns `{"status":"ok"}` and `pnpm validate` passes with all tests green, your local development environment is fully operational.
