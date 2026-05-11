---
title: "Runtime Flow"
description: "Sequence diagrams and operational mechanics for wallet registration, sponsorship execution, and worker processing."
---

# Runtime Flow

This document describes the runtime execution paths for ArcPass, covering both nominal and error scenarios. It includes sequence diagrams for the wallet registration and sponsorship execution flows, plus detailed worker operational mechanics.

## Wallet Registration Flow

The wallet registration endpoint (`POST /wallets/register`) validates the incoming address, normalizes it to lowercase, and either creates a new wallet record or updates an existing one. Blocked wallets are rejected with HTTP 403.

```mermaid
sequenceDiagram
    participant Client
    participant API as Fastify API
    participant DB as PostgreSQL

    Client->>API: POST /wallets/register { walletAddress }
    API->>API: JSON Schema validation (pattern, additionalProperties: false)

    alt Validation fails
        API-->>Client: 400 { error, statusCode }
    end

    API->>API: Normalize address (lowercase)
    API->>DB: SELECT wallet WHERE walletAddress = normalized
    DB-->>API: Wallet record or null

    alt Wallet not found
        API->>DB: INSERT wallet (walletAddress, firstSeenAt, lastSeenAt)
        DB-->>API: New wallet record
        API-->>Client: 201 { id, walletAddress, firstSeenAt, lastSeenAt, sponsorshipCount, isBlocked }
    else Wallet exists and is blocked
        API-->>Client: 403 { error: "Wallet is blocked", statusCode: 403 }
    else Wallet exists and is not blocked
        API->>DB: UPDATE wallet SET lastSeenAt = now(), sponsorshipCount += 1
        DB-->>API: Updated wallet record
        API-->>Client: 200 { id, walletAddress, firstSeenAt, lastSeenAt, sponsorshipCount, isBlocked }
    end
```

### Validation Rules

The JSON Schema enforces:

- `walletAddress` is required
- Pattern: `^0x[0-9a-fA-F]{40}$` (exactly 42 characters)
- `additionalProperties: false` rejects unknown fields
- Invalid requests receive a 400 response with field-level error messages

## Sponsorship Execution Flow

The worker processes sponsorship requests through a multi-stage pipeline: poll discovery, row-level lock acquisition, status transitions, on-chain relay, and receipt confirmation.

```mermaid
sequenceDiagram
    participant Poller
    participant Processor
    participant DB as PostgreSQL
    participant Relay as Relay Executor
    participant Arc as Arc Network

    Poller->>DB: SELECT pending/stale-relayed requests (LIMIT BATCH_SIZE)
    DB-->>Poller: Request IDs (ordered by requestedAt ASC)

    loop For each request in batch
        Poller->>Processor: processRequest(requestId)

        Processor->>DB: SELECT FOR UPDATE SKIP LOCKED (acquire row lock)
        DB-->>Processor: Locked row (id, status, walletId)

        alt Row not found or already locked
            Processor-->>Poller: Skip (no-op)
        else Status not processable (not pending/relayed)
            Processor-->>Poller: Skip
        end

        Processor->>DB: Check wallet.isBlocked
        alt Wallet is blocked
            Processor->>DB: UPDATE status = 'rejected'
            Processor-->>Poller: Result { finalStatus: rejected }
        end

        Processor->>DB: Check existing active relay (submitted/confirmed)
        alt Confirmed relay exists
            Processor->>DB: UPDATE status = 'completed', increment sponsorshipCount
            Processor-->>Poller: Result { finalStatus: completed }
        else Submitted relay exists
            Processor-->>Poller: Skip (in-flight)
        end

        Processor->>DB: Check retry count vs MAX_RETRIES
        alt Max retries exceeded
            Processor->>DB: UPDATE status = 'failed'
            Processor-->>Poller: Result { finalStatus: failed }
        end

        Note over Processor,DB: Status transitions: pending → approved → relayed

        Processor->>DB: UPDATE status = 'approved'
        Processor->>DB: INSERT relay_transaction (status: queued)
        Processor->>DB: UPDATE status = 'relayed'
        Processor->>DB: UPDATE relay_transaction status = 'submitted'

        Processor->>Relay: executeRelay(requestId, relayTxId)
        Relay->>Arc: sponsorTransfer(recipient, amount)

        alt Relay succeeds
            Arc-->>Relay: Transaction receipt (hash, blockNumber)
            Relay-->>Processor: RelayResult { success: true, transactionHash }
            Processor->>DB: UPDATE relay_transaction status = 'confirmed', hash, blockNumber
            Processor->>DB: UPDATE status = 'completed', increment sponsorshipCount
            Processor-->>Poller: Result { finalStatus: completed }
        else AlreadySponsored error
            Arc-->>Relay: Revert (AlreadySponsored)
            Relay-->>Processor: RelayResult { success: false, failureReason: "AlreadySponsored..." }
            Processor->>DB: UPDATE relay_transaction status = 'confirmed'
            Processor->>DB: UPDATE status = 'completed', increment sponsorshipCount
            Processor-->>Poller: Result { finalStatus: completed }
        else Relay fails (other error)
            Arc-->>Relay: Error/revert
            Relay-->>Processor: RelayResult { success: false, failureReason }
            Processor->>DB: UPDATE relay_transaction status = 'failed', failureReason
            Processor->>DB: UPDATE status = 'failed'
            Processor-->>Poller: Result { finalStatus: failed }
        else Transaction timeout
            Relay-->>Processor: RelayResult { success: false, failureReason: "timeout" }
            Processor->>DB: UPDATE relay_transaction status = 'failed'
            Processor->>DB: UPDATE status = 'failed'
            Processor-->>Poller: Result { finalStatus: failed }
        end
    end

    Note over Poller: Schedule next poll after POLL_INTERVAL_MS
```

### Stale-Relayed Recovery

Requests stuck in `relayed` status without an active relay transaction (submitted or confirmed) are recovered on the next poll cycle. The poller query includes:

```sql
SELECT sr.id FROM sponsorship_requests sr
WHERE sr.status = 'pending'
   OR (sr.status = 'relayed' AND NOT EXISTS (
     SELECT 1 FROM relay_transactions rt
     WHERE rt.sponsorshipRequestId = sr.id
       AND rt.status IN ('submitted', 'confirmed')
   ))
ORDER BY sr.requestedAt ASC
LIMIT ${BATCH_SIZE}
```

This handles crash recovery scenarios where the worker terminated after transitioning to `relayed` but before the relay transaction completed.

## Worker Operational Mechanics

### Poll Interval (`POLL_INTERVAL_MS`)

The worker uses `setTimeout` (not `setInterval`) to schedule poll cycles, preventing overlapping executions. After each cycle completes, the next is scheduled after `POLL_INTERVAL_MS` milliseconds.

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `POLL_INTERVAL_MS` | 5000 | 1000–60000 | Delay between poll cycles in milliseconds |

The first poll cycle starts immediately on worker startup. Subsequent cycles are scheduled only after the previous cycle finishes processing all batch items.

### Batch Size (`BATCH_SIZE`)

Each poll cycle fetches up to `BATCH_SIZE` pending or stale-relayed requests, ordered by `requestedAt ASC` (oldest first). Requests are processed sequentially within a batch — each wrapped in its own try/catch so a failure in one does not prevent processing of remaining items.

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `BATCH_SIZE` | 20 | 1–100 | Maximum requests fetched per poll cycle |

### Row-Level Locking (`SELECT FOR UPDATE SKIP LOCKED`)

The processor acquires an exclusive row-level lock on each sponsorship request within a database transaction:

```sql
SELECT id, status, "walletId" FROM sponsorship_requests
WHERE id = $1
FOR UPDATE SKIP LOCKED
```

Key behaviors:

- **Exclusive lock**: Only one processor instance can work on a given request at a time
- **SKIP LOCKED**: If the row is already locked by another transaction, the query returns zero rows and the processor skips it (no blocking)
- **Transaction-scoped**: The lock is held for the duration of the Prisma `$transaction` block, which includes the full relay execution
- **Timeout**: The transaction has a configurable timeout (`LOCK_TIMEOUT_MS`, default 30000ms) to prevent indefinite lock holding

This pattern enables safe concurrent processing if multiple worker instances are deployed, without requiring external coordination.

### Stale-Relayed Recovery

Requests can become stuck in `relayed` status if the worker crashes after creating a relay transaction but before receiving confirmation. The recovery mechanism:

1. The poller query includes `relayed` requests that have no relay transaction in `submitted` or `confirmed` status
2. The processor creates a new relay transaction with an incremented `relayAttempt` number
3. Processing continues through the normal relay execution path
4. The `MAX_RETRIES` limit (default 5) prevents infinite retry loops

### Graceful Shutdown (SIGTERM/SIGINT)

The worker registers handlers for both `SIGTERM` and `SIGINT` signals. On receiving either signal:

1. **Set shutdown flag**: The `isRunning` flag is set to `false`, preventing new poll cycles from starting
2. **Clear pending timeout**: If a poll cycle is scheduled but not yet running, the timeout is cleared and shutdown completes immediately
3. **Wait for in-progress work**: If a poll cycle is actively processing, the shutdown waits for it to complete
4. **Bounded drain timeout**: A `setTimeout` enforces `SHUTDOWN_TIMEOUT_MS` (default 10000ms). If the in-progress work does not complete within this window:
   - A warning is logged: "Shutdown timed out, in-progress relay may need manual reconciliation"
   - The process exits with code 1
5. **Prisma disconnect**: On successful drain, the Prisma client is disconnected before exit

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `SHUTDOWN_TIMEOUT_MS` | 10000 | 5000–60000 | Maximum time to wait for in-progress work during shutdown |

<Warning>If the shutdown timeout fires during an active relay, the on-chain transaction may have been submitted but not yet confirmed. The stale-relayed recovery mechanism handles this on the next startup.</Warning>

### Chain ID Verification at Startup

Before the worker begins polling, it verifies that the configured `CHAIN_ID` matches the chain ID reported by the RPC endpoint. This catches misconfiguration early (e.g., pointing at testnet when mainnet is expected).

The verification flow:

1. Worker calls `publicClient.getChainId()` against the configured `CHAIN_RPC_URL`
2. The call races against a timeout of `CHAIN_ID_VERIFY_TIMEOUT_MS` (default 10000ms)
3. If the RPC does not respond in time, a `ChainIdVerificationTimeoutError` is thrown and the worker exits with code 1
4. If the returned chain ID does not match `CHAIN_ID`, a `ChainIdMismatchError` is thrown and the worker exits with code 1
5. On success, the worker logs the verified chain ID and proceeds to initialize contract clients and start polling

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `CHAIN_ID` | — (required) | positive integer | Expected chain ID for the target network |
| `CHAIN_ID_VERIFY_TIMEOUT_MS` | 10000 | 1000–30000 | Timeout for the RPC chain ID check |

<Note>Chain ID verification is a startup-only check. If the RPC endpoint switches networks after startup (unlikely but possible with misconfigured load balancers), the worker will not detect it until the next restart.</Note>

## Related Documentation

- [System Overview](./system-overview.md) — full request flow and sponsorship lifecycle
- [Database Architecture](../backend/database.md) — status transitions and schema details
- [Security Model](../security/security-model.md) — row-level locking and hardening measures
- [Runbooks](../operations/runbooks.md) — recovery procedures for stuck requests
