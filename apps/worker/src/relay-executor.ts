import { parseEther } from 'viem'
import type { PublicClient, WalletClient, Account } from 'viem'
import { prisma } from '@arcpass/shared'
import { createLogger } from './logger.js'
import type { WorkerConfig } from './config.js'

export interface RelayResult {
  success: boolean
  transactionHash: string | null
  failureReason: string | null
  blockNumber?: bigint | null
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

/** Default sponsorship amount: 0.001 native token */
const SPONSORSHIP_AMOUNT = parseEther('0.001')

/**
 * Initializes the relay executor with viem clients and configuration.
 * Must be called once at worker startup before any relay execution.
 */
export function initializeRelayExecutor(clients: {
  publicClient: PublicClient
  walletClient: WalletClient
  account: Account
}, config: Pick<WorkerConfig, 'confirmationBlocks' | 'txTimeoutMs'>): void {
  publicClient = clients.publicClient
  walletClient = clients.walletClient
  account = clients.account
  confirmationBlocks = config.confirmationBlocks
  txTimeoutMs = config.txTimeoutMs
}

/**
 * Executes a real blockchain relay for a sponsorship request.
 * Drop-in replacement for simulateRelay.
 *
 * @param sponsorshipRequestId - The ID of the sponsorship request to relay
 * @param _failureRate - Accepted for API compatibility, ignored
 * @returns RelayResult with success/failure status and transaction hash
 */
export async function executeRelay(
  sponsorshipRequestId: string,
  _failureRate?: number
): Promise<RelayResult> {
  let pendingHash: string | null = null

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

    // Step 2: Construct and broadcast native token transfer
    logger.info('Broadcasting transaction', {
      sponsorshipRequestId,
      walletAddress,
    })

    const hash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: walletAddress,
      value: SPONSORSHIP_AMOUNT,
    })

    pendingHash = hash

    logger.info('Transaction broadcast successful', {
      sponsorshipRequestId,
      transactionHash: hash,
    })

    // Step 3: Wait for transaction receipt with configured confirmations and timeout
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: confirmationBlocks,
      timeout: txTimeoutMs,
    })

    // Step 4: Map receipt status to RelayResult
    if (receipt.status === 'success') {
      logger.info('Transaction confirmed', {
        transactionHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        confirmations: confirmationBlocks,
      })

      return {
        success: true,
        transactionHash: hash,
        failureReason: null,
        blockNumber: receipt.blockNumber,
      }
    } else {
      // status === 'reverted'
      logger.error('Transaction reverted', {
        sponsorshipRequestId,
        transactionHash: hash,
        blockNumber: receipt.blockNumber.toString(),
      })

      return {
        success: false,
        transactionHash: hash,
        failureReason: 'transaction reverted',
        blockNumber: receipt.blockNumber,
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error('Relay execution failed', {
      sponsorshipRequestId,
      failureReason: message,
      transactionHash: pendingHash,
    })

    return {
      success: false,
      transactionHash: pendingHash,
      failureReason: message,
      blockNumber: null,
    }
  }
}
