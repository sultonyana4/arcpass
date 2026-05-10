# ArcPass Database Model

# Overview

ArcPass uses PostgreSQL as the primary persistence layer.

The database is responsible for:
- sponsorship tracking
- anti-abuse state
- transaction lifecycle tracking
- replay prevention
- operational auditing

The MVP intentionally keeps the schema minimal.

---

# Core Entities

The MVP database contains four primary entities:

1. Wallet
2. SponsorshipRequest
3. RelayTransaction
4. RateLimit

---

# Entity Relationships

Wallet
└── SponsorshipRequest
    └── RelayTransaction

RateLimit exists independently for infrastructure protection.

---

# Wallet

Represents a unique user wallet address.

Purpose:
- onboarding eligibility tracking
- sponsorship ownership
- anti-abuse tracking

Important fields:
- id
- walletAddress
- firstSeenAt
- lastSeenAt
- sponsorshipCount
- isBlocked
- blockReason

Rules:
- one wallet address must be unique
- wallet address stored normalized/lowercase
- blocked wallets cannot request sponsorship

---

# SponsorshipRequest

Represents a single onboarding sponsorship attempt.

Purpose:
- onboarding workflow tracking
- sponsorship lifecycle management
- eligibility result persistence

Important fields:
- id
- walletId
- status
- eligibilityReason
- requestedAt
- approvedAt
- rejectedAt
- completedAt
- failedAt
- ipAddress
- userAgent

Status values:
- pending
- approved
- rejected
- relayed
- completed
- failed

Rules:
- one wallet may only have one successful sponsorship
- rejected sponsorships remain stored for auditing
- status transitions must be deterministic

---

# RelayTransaction

Represents blockchain relay execution state.

Purpose:
- blockchain transaction tracking
- retry management
- confirmation monitoring

Important fields:
- id
- sponsorshipRequestId
- transactionHash
- status
- relayAttempt
- submittedAt
- confirmedAt
- failedAt
- failureReason

Status values:
- queued
- submitted
- confirmed
- failed

Rules:
- transaction hashes must be unique
- retries increment relayAttempt
- failed relay attempts remain auditable

---

# RateLimit

Represents anti-abuse infrastructure tracking.

Purpose:
- request throttling
- abuse prevention
- operational protection

Important fields:
- id
- identifier
- identifierType
- requestCount
- windowStart
- blockedUntil

Identifier types:
- ip
- wallet
- user-agent

Rules:
- rate limit windows should expire automatically
- blocked identifiers cannot create sponsorship requests

---

# Database Constraints

Important constraints:
- walletAddress unique
- transactionHash unique
- foreign key integrity required
- timestamps required on all critical lifecycle events

---

# Infrastructure Strategy

Database:
- PostgreSQL

Future cache/queue:
- Redis

ORM:
- Prisma (planned)

The MVP intentionally avoids premature complexity.

---

# Security Priorities

Important protections:
- replay prevention
- duplicate sponsorship prevention
- immutable audit history
- deterministic status transitions
- normalized wallet storage

Operational correctness is more important than schema complexity.

---

# Future Expansion

Possible future entities:
- DeviceFingerprint
- ReputationScore
- EcosystemIntegration
- SponsorshipQuota
- APIKey
- PartnerProject

Future expansion should not compromise MVP simplicity.