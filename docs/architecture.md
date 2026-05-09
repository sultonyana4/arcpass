# ArcPass Architecture

## Overview

ArcPass is a public onboarding infrastructure layer for Arc Network.

The system sponsors the first onboarding transaction for eligible wallets to solve the cold-start gas problem on Arc.

---

# Core System Design

ArcPass uses a modular monorepo architecture.

Services are separated into:
- frontend onboarding UI
- sponsorship API
- blockchain relay worker

---

# Monorepo Structure

apps/web
Public onboarding frontend.

Responsibilities:
- wallet connection
- onboarding flow
- eligibility requests
- transaction status UI

---

apps/api
Core sponsorship API service.

Responsibilities:
- wallet eligibility validation
- anti-abuse checks
- sponsorship request creation
- transaction orchestration
- status responses

---

apps/worker
Blockchain relay worker.

Responsibilities:
- execute sponsored transactions
- interact with Arc RPC
- monitor transaction confirmations
- retry failed transactions
- queue processing

---

packages/shared
Shared utilities and types.

Examples:
- API types
- validation schemas
- constants
- shared helpers

---

packages/sdk
Future public SDK for Arc ecosystem builders.

Possible future usage:
- embedded onboarding
- sponsor request integration
- ArcPass widgets

---

# Sponsorship Lifecycle

1. User connects wallet
2. Frontend requests eligibility check
3. API validates wallet
4. Anti-abuse rules executed
5. Sponsorship request created
6. Worker relays onboarding transaction
7. Transaction status returned
8. Wallet becomes activated on Arc

---

# MVP Scope

The MVP only supports:
- one sponsored onboarding transaction per wallet
- basic anti-abuse protection
- transaction status tracking

The MVP does NOT include:
- token systems
- advanced analytics
- multi-chain support
- complex dashboards
- mobile applications

---

# Infrastructure

Frontend:
- Next.js
- TailwindCSS
- TypeScript

Backend:
- Fastify
- Node.js

Infra:
- Docker
- Cloud Run
- Redis
- PostgreSQL

Blockchain:
- Arc RPC
- Native USDC gas model

---

# Scalability Strategy

The architecture is designed for:
- horizontal API scaling
- isolated relay workers
- queue-based transaction processing
- reusable SDK integrations
- future ecosystem integrations

---

# Security Priorities

Important protections:
- wallet rate limiting
- IP throttling
- replay prevention
- onboarding-only sponsorship
- environment secret isolation

The MVP should prioritize simplicity and operational safety.