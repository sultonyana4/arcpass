import { prisma } from '@arcpass/shared'
import { loadConfig } from './config.js'
import { createPoller } from './poller.js'
import type { WorkerConfig } from './config.js'
import type { Poller } from './poller.js'

let poller: Poller | null = null
let config: WorkerConfig | null = null

/**
 * Starts the sponsorship worker.
 * Initializes configuration, connects Prisma, and begins polling for pending requests.
 * Resolves when the worker is actively processing.
 */
export async function start(): Promise<void> {
  config = loadConfig()
  poller = createPoller(config)
  poller.start()
  console.info('[worker] Started')
}

/**
 * Stops the sponsorship worker gracefully.
 * Ceases polling, awaits any in-progress job (up to shutdownTimeoutMs),
 * and disconnects the Prisma client.
 * Resolves when all resources are released.
 * Safe to call even if start() hasn't been called (no-op).
 */
export async function stop(): Promise<void> {
  if (!poller) {
    return
  }

  const timeoutMs = config?.shutdownTimeoutMs ?? 10000

  // Race poller stop against shutdown timeout
  const pollerStop = poller.stop()

  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs)
  })

  await Promise.race([pollerStop, timeout])

  await prisma.$disconnect()
  console.info('[worker] Stopped')

  poller = null
  config = null
}
