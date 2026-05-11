import { prisma } from '@arcpass/shared'
import type { WorkerConfig } from './config.js'
import { createLogger } from './logger.js'
import { processRequest } from './processor.js'

const logger = createLogger('poller')

export interface Poller {
  start(): void
  stop(): Promise<void>
}

/**
 * Creates a poller that periodically queries for pending sponsorship requests
 * and dispatches them to the processor sequentially.
 *
 * Uses setTimeout (not setInterval) to prevent overlapping poll cycles.
 * The processor handles its own row-level locking via SELECT FOR UPDATE SKIP LOCKED,
 * so the poller just finds pending request IDs and dispatches them.
 */
export function createPoller(config: WorkerConfig): Poller {
  let isRunning = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let processingPromise: Promise<void> | null = null
  let stopResolve: (() => void) | null = null

  async function pollCycle(): Promise<void> {
    if (!isRunning) return

    try {
      // Query pending requests AND stale relayed requests ordered by requestedAt ASC.
      // Stale relayed requests are those with no active relay transaction (submitted/confirmed),
      // which can occur after a crash. This enables recovery on the next poll cycle (Req 9.3).
      // The processor handles row-level locking internally via SELECT FOR UPDATE SKIP LOCKED,
      // which satisfies Requirement 5.5 (skip locked rows).
      const pendingRequests = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT sr.id FROM "sponsorship_requests" sr
        WHERE sr.status = 'pending'
           OR (sr.status = 'relayed' AND NOT EXISTS (
             SELECT 1 FROM "relay_transactions" rt
             WHERE rt."sponsorshipRequestId" = sr.id
               AND rt.status IN ('submitted', 'confirmed')
           ))
        ORDER BY sr."requestedAt" ASC
        LIMIT ${config.batchSize}
      `

      // Dispatch each request to the processor sequentially.
      // Each request is wrapped in its own try/catch so that an unhandled exception
      // from one request does not prevent processing of remaining batch items (Req 9.6).
      for (const request of pendingRequests) {
        if (!isRunning) break

        try {
          const result = await processRequest(request.id, config)

          if (!result.success) {
            logger.error('Failed to process request', {
              requestId: request.id,
              error: result.error,
            })
          }
        } catch (requestError) {
          const message = requestError instanceof Error ? requestError.message : String(requestError)
          logger.error('Unhandled exception processing request', {
            requestId: request.id,
            error: message,
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error during poll cycle', { error: message })
    }

    // Schedule next cycle if still running
    scheduleNextCycle()
  }

  function scheduleNextCycle(): void {
    if (!isRunning) {
      // Signal that processing is done so stop() can resolve
      if (stopResolve) {
        stopResolve()
        stopResolve = null
      }
      return
    }

    timeoutId = setTimeout(() => {
      timeoutId = null
      processingPromise = pollCycle()
    }, config.pollIntervalMs)
  }

  function start(): void {
    if (isRunning) return

    isRunning = true
    logger.info('Starting poll cycles')

    // Start the first cycle immediately
    processingPromise = pollCycle()
  }

  function stop(): Promise<void> {
    if (!isRunning) return Promise.resolve()

    isRunning = false
    logger.info('Stopping poll cycles')

    // Clear any pending timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
      return Promise.resolve()
    }

    // If currently processing, wait for it to finish
    if (processingPromise) {
      return new Promise<void>((resolve) => {
        stopResolve = resolve
      })
    }

    return Promise.resolve()
  }

  return { start, stop }
}
