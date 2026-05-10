import { prisma } from '@arcpass/shared'
import { loadConfig } from './config.js'
import { createPoller } from './poller.js'
import { createViemClients, verifyChainId } from './viem-client.js'
import { initializeContractClient } from './contract-client.js'
import { initializeRelayExecutor } from './relay-executor.js'
import { sponsorVaultAbi, sponsorshipRegistryAbi } from './abis/index.js'
import { createLogger } from './logger.js'
import type { WorkerConfig } from './config.js'
import type { Poller } from './poller.js'

const logger = createLogger('worker')

let poller: Poller | null = null
let config: WorkerConfig | null = null

/**
 * Starts the sponsorship worker.
 * Initializes configuration, validates viem clients, verifies chain ID,
 * initializes contract client, and begins polling for pending requests.
 * Resolves when the worker is actively processing.
 */
export async function start(): Promise<void> {
  config = loadConfig()

  // Initialize viem clients (validates private key cryptographically)
  const clients = createViemClients(config)

  // Log sponsor wallet address for operational verification (no private key)
  logger.info('Sponsor wallet initialized', {
    address: clients.account.address,
  })

  // Log chain RPC URL domain only (hostname, no credentials)
  const rpcHostname = new URL(config.chainRpcUrl).hostname
  logger.info('Chain RPC configured', {
    rpcHost: rpcHostname,
  })

  // Verify chain ID matches RPC endpoint — terminate on mismatch
  try {
    await verifyChainId(clients.publicClient, config.chainId, config.chainIdVerifyTimeoutMs)
    logger.info('Chain ID verified', { chainId: config.chainId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Chain ID verification failed', { error: message })
    process.exit(1)
  }

  // Initialize contract client with ABIs and contract addresses
  initializeContractClient(clients, {
    sponsorVaultAddress: config.contractAddressSponsorVault,
    sponsorshipRegistryAddress: config.contractAddressSponsorshipRegistry,
    sponsorVaultAbi,
    sponsorshipRegistryAbi,
  }, config.txTimeoutMs, config.explorerBaseUrl)
  logger.info('Contract client initialized', {
    sponsorVault: config.contractAddressSponsorVault,
    sponsorshipRegistry: config.contractAddressSponsorshipRegistry,
  })

  // Initialize relay executor with viem clients and config (includes sponsorshipAmount)
  initializeRelayExecutor(clients, {
    confirmationBlocks: config.confirmationBlocks,
    txTimeoutMs: config.txTimeoutMs,
    sponsorshipAmount: config.sponsorshipAmount,
  })

  poller = createPoller(config)
  poller.start()
  logger.info('Worker started')
}

/**
 * Stops the sponsorship worker gracefully.
 * Ceases polling, awaits any in-progress job (up to shutdownTimeoutMs),
 * and disconnects the Prisma client.
 * If the poller does not stop within the timeout, force-exits with code 1
 * so the orchestrator can restart the container.
 * Safe to call even if start() hasn't been called (no-op).
 */
export async function stop(): Promise<void> {
  if (!poller) return

  const timeoutMs = config?.shutdownTimeoutMs ?? 10000

  const pollerStop = poller.stop()
  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs)
  })

  const result = await Promise.race([
    pollerStop.then(() => 'done' as const),
    timeout,
  ])

  await prisma.$disconnect()
  logger.info('Worker stopped')

  poller = null
  config = null

  if (result === 'timeout') {
    logger.error('Shutdown timeout exceeded — force exiting', {
      timeoutMs,
    })
    process.exit(1)
  }
}
