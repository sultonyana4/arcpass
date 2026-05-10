import { prisma } from '@arcpass/shared'
import type { WorkerConfig } from './config.js'
import { processRequest } from './processor.js'

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
      // Query pending requests ordered by requestedAt ASC, limited by batch size.
      // The processor handles row-level locking internally via SELECT FOR UPDATE SKIP LOCKED,
      // which satisfies Requirement 5.5 (skip locked rows).
      const pendingRequests = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "sponsorship_requests"
        WHERE status = 'pending'
        ORDER BY "requestedAt" ASC
        LIMIT ${config.batchSize}
      `

      // Dispatch each request to the processor sequentially
      for (const request of pendingRequests) {
        if (!isRunning) break

        const result = await processRequest(request.id, config)

        // Log failures and continue with remaining batch (Req 1.6)
        if (!result.success) {
          console.error(
            `[poller] Failed to process request ${request.id}: ${result.error}`
          )
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[poller] Error during poll cycle: ${message}`)
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
    console.info('[poller] Starting poll cycles')

    // Start the first cycle immediately
    processingPromise = pollCycle()
  }

  function stop(): Promise<void> {
    if (!isRunning) return Promise.resolve()

    isRunning = false
    console.info('[poller] Stopping poll cycles')

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
