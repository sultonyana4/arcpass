import type { PublicClient, WalletClient, Account } from 'viem'
import { prisma } from '@arcpass/shared'
import { createLogger } from './logger.js'
import { executeContractRelay } from './contract-client.js'
import type { WorkerConfig } from './config.js'

export interface RelayResult {
  success: boolean
  transactionHash: string | null
  failureReason: string | null
  blockNumber?: bigint | null
  eventData?: {
    recipient: string
    amount: bigint
    timestamp: bigint
  } | null
}

const logger = createLogger('relay-executor')

/**
 * Module-level references to viem clients and config.
 * Must be initialized via `initializeRelayExecutor()` before calling `executeRelay()`.
 */
let walletClient: WalletClient | null = null
let publicClient: PublicClient | null = null
let account: Account | null = null
let confirmationBlocks = 2
let txTimeoutMs = 120000
let sponsorshipAmount: bigint = 1000000000000000n // 0.001 ETH default

/**
 * Initializes the relay executor with viem clients and configuration.
 * Must be called once at worker startup before any relay execution.
 */
export function initializeRelayExecutor(clients: {
  publicClient: PublicClient
  walletClient: WalletClient
  account: Account
}, config: Pick<WorkerConfig, 'confirmationBlocks' | 'txTimeoutMs' | 'sponsorshipAmount'>): void {
  publicClient = clients.publicClient
  walletClient = clients.walletClient
  account = clients.account
  confirmationBlocks = config.confirmationBlocks
  txTimeoutMs = config.txTimeoutMs
  sponsorshipAmount = config.sponsorshipAmount
}

/**
 * Executes a real blockchain relay for a sponsorship request.
 * Delegates to the contract integration layer (executeContractRelay) which calls
 * SponsorVault.sponsorTransfer on-chain.
 *
 * @param sponsorshipRequestId - The ID of the sponsorship request to relay
 * @param relayAttempt - The current relay attempt number (for structured logging)
 * @returns RelayResult with success/failure status and transaction hash
 */
export async function executeRelay(
  sponsorshipRequestId: string,
  relayAttempt?: number
): Promise<RelayResult> {
  const startTime = Date.now()

  try {
    if (!walletClient || !publicClient || !account) {
      return {
        success: false,
        transactionHash: null,
        failureReason: 'Relay executor not initialized — call initializeRelayExecutor() first',
      }
    }

    // Step 1: Query sponsorship request to resolve target wallet address
    const request = await prisma.sponsorshipRequest.findUnique({
      where: { id: sponsorshipRequestId },
      include: { wallet: true },
    })

    if (!request) {
      return {
        success: false,
        transactionHash: null,
        failureReason: `Sponsorship request not found: ${sponsorshipRequestId}`,
      }
    }

    const walletAddress = request.wallet.walletAddress as `0x${string}`

    // Log relay attempt start with structured fields
    logger.info('Relay attempt starting', {
      sponsorshipRequestId,
      relayAttempt: relayAttempt ?? null,
      walletAddress,
    })

    // Step 2: Delegate to contract client for on-chain execution
    const contractResult = await executeContractRelay(walletAddress, sponsorshipAmount, {
      sponsorshipRequestId,
      relayAttempt,
    })

    // Step 3: Map ContractRelayResult to RelayResult and log outcome
    if (contractResult.success) {
      logger.info('Relay execution outcome', {
        sponsorshipRequestId,
        relayAttempt: relayAttempt ?? null,
        transactionHash: contractResult.transactionHash,
        outcome: 'confirmed',
        blockNumber: contractResult.blockNumber?.toString() ?? null,
      })
    } else {
      const elapsedMs = Date.now() - startTime
      logger.error('Relay execution outcome', {
        sponsorshipRequestId,
        relayAttempt: relayAttempt ?? null,
        transactionHash: contractResult.transactionHash,
        outcome: contractResult.transactionHash ? 'reverted' : 'error',
        failureReason: contractResult.failureReason,
        elapsedMs,
      })
    }

    return {
      success: contractResult.success,
      transactionHash: contractResult.transactionHash,
      failureReason: contractResult.failureReason,
      blockNumber: contractResult.blockNumber,
      eventData: contractResult.eventData,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const elapsedMs = Date.now() - startTime

    logger.error('Relay execution outcome', {
      sponsorshipRequestId,
      relayAttempt: relayAttempt ?? null,
      transactionHash: null,
      outcome: 'error',
      failureReason: message,
      elapsedMs,
    })

    return {
      success: false,
      transactionHash: null,
      failureReason: message,
      blockNumber: null,
      eventData: null,
    }
  }
}
