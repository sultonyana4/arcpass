# Wallet Sponsorship Design

## Overview

The sponsorship system allows registered wallets to request sponsored gas funding through an async-compatible workflow.

The architecture separates:
- wallet identity
- sponsorship lifecycle
- relay execution tracking

## Request Flow

1. Wallet registers through wallet registry API
2. Wallet submits sponsorship request
3. API validates eligibility
4. API creates sponsorship request with `pending` status
5. Worker/future relay system processes the request
6. Relay transaction records are attached
7. Status transitions are updated until completion

## Validation Rules

### Wallet Validation
- wallet must exist
- wallet must not be blocked

### Duplicate Protection
- wallet cannot have active pending sponsorship request

### Metadata Tracking
- request stores:
  - ip address
  - user agent
  - timestamps

## Status Lifecycle

### SponsorshipRequest
pending
→ approved
→ relayed
→ completed

Failure path:
pending
→ rejected

or

relayed
→ failed

## Database Responsibilities

### Wallet
Stores:
- normalized wallet identity
- sponsorship usage counters
- block state

### SponsorshipRequest
Stores:
- sponsorship lifecycle
- eligibility state
- audit metadata

### RelayTransaction
Stores:
- relay execution attempts
- transaction hashes
- relay failures
- confirmation timestamps

### RateLimit
Stores:
- anti-spam counters
- temporary blocking windows

## Future Compatibility

The architecture must support:
- async queue workers
- retry processing
- Circle relayer integration
- monitoring dashboards
- analytics