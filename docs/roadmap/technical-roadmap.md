---
title: "Technical Roadmap"
description: "Completed milestones, planned work items, and production readiness criteria for ArcPass mainnet deployment."
---

# Technical Roadmap

This document tracks the engineering progress of ArcPass from initial MVP through production readiness. Completed milestones reflect delivered functionality verified by the validation suite. Planned items represent the next phases of development toward mainnet deployment.

---

## Completed Milestones

All milestones below have been implemented, tested, and integrated into the monorepo.

| # | Milestone | Status |
|---|-----------|--------|
| 1 | API Service | ✅ Completed |
| 2 | Database Foundation | ✅ Completed |
| 3 | Wallet Registry | ✅ Completed |
| 4 | Sponsorship MVP | ✅ Completed |
| 5 | Worker Runtime | ✅ Completed |
| 6 | Relay Execution | ✅ Completed |
| 7 | Docker Integration | ✅ Completed |
| 8 | Production Hardening | ✅ Completed |
| 9 | Validation Suite | ✅ Completed |

### 1. API Service

Fastify 5.x HTTP service with plugin-based architecture handling wallet registration, sponsorship requests, and relay transaction queries. Includes structured JSON Schema validation, CORS, security headers, and correlation ID tracking across all requests.

### 2. Database Foundation

PostgreSQL database managed through Prisma ORM with a normalized schema covering wallets, sponsorship requests, relay transactions, and rate limits. Includes indexed columns for query performance and migrations for schema evolution.

### 3. Wallet Registry

Wallet registration and lookup system with address validation, duplicate detection, and blocking capabilities. Supports eligibility checks at both the API layer and worker layer to prevent abuse from restricted wallets.

### 4. Sponsorship MVP

End-to-end sponsorship request lifecycle from submission through approval, relay, and completion. Implements the full state machine (pending → approved → relayed → completed | failed | rejected) with status tracking and paginated history queries.

### 5. Worker Runtime

Background polling service that discovers approved sponsorship requests, acquires row-level locks via `SELECT FOR UPDATE SKIP LOCKED`, and processes them in configurable batches. Supports graceful shutdown with bounded drain timeout on SIGTERM/SIGINT signals.

### 6. Relay Execution

On-chain transaction relay through the SponsorVault smart contract using viem. Handles transaction submission, receipt confirmation, event parsing, and failure recovery with configurable retry logic and stale-relayed request detection.

### 7. Docker Integration

Full Docker Compose orchestration with multi-stage Dockerfile builds (deps → build → prod-deps → runtime) for all services. Includes health checks, dependency ordering, internal networking via service names, and volume persistence for PostgreSQL data.

### 8. Production Hardening

Security and reliability measures including IP and wallet rate limiting with sliding-window counters, 5-second replay protection, frozen configuration objects, security headers (CSP, X-Frame-Options, X-Content-Type-Options), JSON Schema strictness with `additionalProperties: false`, and graceful shutdown with a 10-second timeout.

### 9. Validation Suite

Comprehensive integration test suite covering environment configuration, database schema integrity, API endpoint behavior, worker polling mechanics, relay execution, contract deployment validation, lifecycle state transitions, and production hardening measures. Runs via `pnpm validate` as a pre-merge gate.

---

## Planned Work

Items below represent upcoming development phases. Each item includes a scope description defining the boundaries of the work.

### Planned: Infrastructure Stabilization

| # | Item | Scope |
|---|------|-------|
| 1 | Observability Stack | 🔲 Planned |
| 2 | Automated Database Backups | 🔲 Planned |
| 3 | CI/CD Pipeline | 🔲 Planned |
| 4 | Load Testing Framework | 🔲 Planned |

**Observability Stack** — Integrate structured logging aggregation, request tracing with correlation IDs across services, and health metric dashboards for API latency, worker throughput, and database connection pool utilization.

**Automated Database Backups** — Configure scheduled PostgreSQL backups with point-in-time recovery, automated retention policies, and restore verification procedures for disaster recovery scenarios.

**CI/CD Pipeline** — Establish automated build, test, and deployment pipeline triggered on pull request merge, including Docker image builds, migration dry-runs, validation suite execution, and staged rollout to production.

**Load Testing Framework** — Build repeatable load test scenarios simulating concurrent wallet registrations and sponsorship requests to identify throughput limits, connection pool saturation points, and worker backpressure thresholds.

### Planned: Integrations

| # | Item | Scope |
|---|------|-------|
| 1 | Circle Integration | 🔲 Planned |
| 2 | Paymaster Patterns | 🔲 Planned |

**Circle Integration** — Connect to Circle's programmable wallets API for managed key custody and transaction signing, enabling institutional-grade key management without self-hosted HSM infrastructure.

**Paymaster Patterns** — Implement ERC-4337 compatible paymaster interfaces allowing ArcPass to sponsor UserOperation gas fees for smart contract wallets, extending coverage beyond EOA-only sponsorship.

### Planned: SDK Development

| # | Item | Scope |
|---|------|-------|
| 1 | SDK Package | 🔲 Planned |

The `packages/sdk` package will provide a typed client library for third-party developers integrating ArcPass sponsorship into their applications.

**Target Consumers:**
- dApp frontend developers building on Arc Network
- Backend services automating wallet onboarding flows
- Ecosystem partners embedding sponsorship into their onboarding funnels

**Public Surface Area:**
- `ArcPassClient` class with configuration for API base URL and optional API key
- `registerWallet(address)` — register a wallet for sponsorship eligibility
- `requestSponsorship(address)` — submit a sponsorship request for an eligible wallet
- `getSponsorshipStatus(id)` — poll sponsorship request status by ID
- `getWalletHistory(address, options?)` — retrieve paginated sponsorship history
- `getRelayTransaction(id)` — look up relay transaction details

**Capabilities:**
- TypeScript-first with full type exports for request/response shapes
- Automatic retry with exponential backoff on transient failures
- Built-in rate limit awareness (respects Retry-After headers)
- Zero runtime dependencies beyond native fetch
- Tree-shakeable ESM build for minimal bundle impact
- Comprehensive JSDoc documentation on all public methods

---

## Production Readiness

The following measurable criteria must be satisfied before mainnet deployment. Each criterion defines a verifiable threshold or condition.

| # | Criterion | Target |
|---|-----------|--------|
| 1 | Service Uptime | ≥ 99.5% measured over a rolling 7-day window |
| 2 | Validation Suite Pass Rate | 100% of tests passing on the deployment commit |
| 3 | API Response Latency (p95) | ≤ 500ms for all endpoints under normal load |
| 4 | Security Audit | Independent audit completed with no critical or high findings unresolved |
| 5 | Relay Success Rate | ≥ 98% of approved sponsorships reach `completed` status within 60 seconds |
| 6 | Database Backup Verification | Automated backups with verified restore tested within the last 7 days |
| 7 | Load Test Baseline | System sustains ≥ 50 concurrent sponsorship requests without degradation |
| 8 | Graceful Degradation | Worker recovers from RPC outages without data loss or duplicate relays |

<Note>
These criteria are evaluated against testnet performance before mainnet promotion. The security audit criterion blocks deployment regardless of other metrics.
</Note>
