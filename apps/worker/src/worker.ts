import { prisma } from '@arcpass/shared'
import { loadConfig } from './config.js'
import { createPoller } from './poller.js'
import { createViemClients } from './viem-client.js'
import { initializeRelayExecutor } from './relay-executor.js'
import { createLogger } from './logger.js'
import type { WorkerConfig } from './config.js'
import type { Poller } from './poller.js'

const logger = createLogger('worker')

let poller: Poller | null = null
let config: WorkerConfig | null = null

/**
 * Starts the sponsorship worker.
 * Initializes configuration, validates viem clients, and begins polling for pending requests.
 * Resolves when the worker is actively processing.
 */
export async function start(): Promise<void> {
  config = loadConfig()

  // Initialize viem clients (validates private key cryptographically)
  const clients = createViemClients(config)

  // Initialize relay executor with viem clients and config
  initializeRelayExecutor(clients, config)

  // Log sponsor wallet address for operational verification (no private key)
  logger.info('Sponsor wallet initialized', {
    address: clients.account.address,
  })

  // Log chain RPC URL domain only (hostname, no credentials)
  const rpcHostname = new URL(config.chainRpcUrl).hostname
  logger.info('Chain RPC configured', {
    rpcHost: rpcHostname,
  })

  poller = createPoller(config)
  poller.start()
  logger.info('Worker started')
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
  logger.info('Worker stopped')

  poller = null
  config = null
}
