# ArcPass AI Engineering Rules

## Project Overview

ArcPass is a public onboarding infrastructure layer for Arc Network.

The goal is to solve the cold-start gas problem on Arc by sponsoring the first onboarding transaction for eligible wallets.

ArcPass is NOT:
- a wallet
- a faucet
- a trading platform
- a DeFi app
- a token project

ArcPass IS:
- onboarding infrastructure
- sponsored transaction relay
- developer integration layer
- public ecosystem tooling

---

## Monorepo Structure

apps/
- web = public onboarding frontend
- api = sponsorship API service
- worker = blockchain relay worker

packages/
- shared = shared types/utils
- sdk = future developer SDK
- ui = reusable UI components

infra/
- docker
- deployment
- cloud configs

---

## Engineering Rules

- Use TypeScript everywhere
- Use modular architecture
- Never place business logic directly in routes
- Keep blockchain logic isolated in services/lib
- Shared logic must go into packages/shared
- Never hardcode secrets
- Use environment variables for all config
- Prefer server-side validation
- Write scalable production-grade code
- Avoid overengineering MVP

---

## MVP Scope

The MVP only needs:
1. Wallet eligibility check
2. First transaction sponsorship
3. Anti-abuse protection
4. Transaction status tracking

Do NOT implement:
- token systems
- analytics dashboards
- mobile apps
- unnecessary authentication systems
- complex admin panels

---

## Technical Stack

Frontend:
- Next.js App Router
- TailwindCSS
- TypeScript

Backend:
- Fastify
- Node.js

Infrastructure:
- Docker
- GCP Cloud Run
- Redis
- PostgreSQL

---

## Coding Expectations

- Keep functions small and modular
- Prefer composition over large files
- Avoid unnecessary dependencies
- Prioritize readability and maintainability
- Build production-ready code, not prototypes