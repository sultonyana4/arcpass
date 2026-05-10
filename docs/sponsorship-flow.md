# ArcPass Sponsorship Flow

# Goal

ArcPass sponsors a single onboarding transaction for eligible wallets on Arc Network.

The purpose is to eliminate the cold-start gas problem without enabling unlimited free transactions.

---

# Sponsorship Model

ArcPass does NOT sponsor arbitrary transactions.

ArcPass only sponsors:
- controlled onboarding transactions
- first-time activation flow
- deterministic onboarding actions

This minimizes:
- abuse
- spam
- treasury drain
- operational risk

---

# High-Level Flow

1. User connects wallet
2. Frontend requests eligibility check
3. API validates wallet status
4. Anti-abuse checks executed
5. Sponsorship request created
6. Worker relays onboarding transaction
7. Transaction confirmation monitored
8. User receives successful onboarding status

---

# Eligibility Rules

A wallet is eligible only if:
- wallet has not previously received sponsorship
- wallet passes anti-abuse validation
- wallet is not rate limited
- onboarding transaction is allowed

Future possible checks:
- wallet age
- transaction history
- social verification
- reputation scoring

The MVP should remain intentionally simple.

---

# Anti-Abuse Protection

MVP protections:
- one sponsorship per wallet
- IP rate limiting
- cooldown windows
- request validation

Future protections:
- CAPTCHA
- device fingerprinting
- social verification
- reputation scoring

---

# Sponsorship Lifecycle

## Step 1 — Eligibility Request

Frontend sends:
- wallet address
- optional client metadata

API returns:
- eligible = true/false
- reason
- onboarding availability

---

## Step 2 — Sponsorship Request

Frontend requests onboarding sponsorship.

API:
- validates eligibility again
- creates sponsorship request
- queues transaction job

---

## Step 3 — Worker Execution

Worker:
- builds onboarding transaction
- signs relay transaction
- submits transaction to Arc RPC
- tracks confirmation status

---

## Step 4 — Completion

API returns:
- transaction hash
- onboarding success status
- activation confirmation

Wallet is now activated on Arc ecosystem.

---

# Worker Responsibilities

Worker must:
- isolate blockchain execution
- retry failed transactions
- avoid duplicate execution
- monitor confirmations
- log sponsorship activity

Workers should remain stateless whenever possible.

---

# Transaction Constraints

The MVP only supports:
- one onboarding transaction
- one sponsorship per wallet

The MVP does NOT support:
- arbitrary smart contract execution
- repeated sponsorships
- unlimited gas abstraction

---

# Infrastructure Strategy

Frontend:
- Next.js App Router

API:
- Fastify

Worker:
- isolated relay processor

Storage:
- PostgreSQL
- Redis queue

Infrastructure:
- Docker
- GCP Cloud Run

---

# Security Priorities

Critical protections:
- replay prevention
- duplicate sponsorship prevention
- transaction validation
- request throttling
- environment secret isolation

Operational safety is more important than feature complexity.