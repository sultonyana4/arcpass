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
  explorerUrl?: string | null
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
 * Uses an AbortController with TX_TIMEOUT_MS deadline to enforce bounded
 * transaction confirmation wait times. If the timeout fires before the contract
 * relay completes, returns a failed RelayResult with a timeout failure reason.
 *
 * @param sponsorshipRequestId - The ID of the sponsorship request to relay
 * @param relayTransactionId - The relay transaction ID for structured logging
 * @param relayAttempt - The current relay attempt number (for structured logging)
 * @returns RelayResult with success/failure status and transaction hash
 */
export async function executeRelay(
  sponsorshipRequestId: string,
  relayTransactionId: string,
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
      relayTransactionId,
      relayAttempt: relayAttempt ?? null,
      walletAddress,
    })

    // Step 2: Set up AbortController with TX_TIMEOUT_MS deadline
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), txTimeoutMs)

    let contractResult: Awaited<ReturnType<typeof executeContractRelay>>

    try {
      // Step 3: Race the contract relay against the abort signal
      contractResult = await executeContractRelayWithAbort(
        walletAddress,
        sponsorshipAmount,
        { sponsorshipRequestId, relayTransactionId, relayAttempt },
        abortController.signal
      )
    } finally {
      clearTimeout(timeoutId)
    }

    // Step 4: Map ContractRelayResult to RelayResult and log outcome
    if (contractResult.success) {
      logger.info('Relay execution outcome', {
        sponsorshipRequestId,
        relayTransactionId,
        relayAttempt: relayAttempt ?? null,
        walletAddress,
        transactionHash: contractResult.transactionHash,
        outcome: 'confirmed',
        blockNumber: contractResult.blockNumber?.toString() ?? null,
      })
    } else {
      const elapsedMs = Date.now() - startTime
      logger.error('Relay execution outcome', {
        sponsorshipRequestId,
        relayTransactionId,
        relayAttempt: relayAttempt ?? null,
        walletAddress,
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
      explorerUrl: contractResult.explorerUrl,
      eventData: contractResult.eventData,
    }
  } catch (error) {
    const elapsedMs = Date.now() - startTime

    // Check if the error is an abort (timeout) signal
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('Transaction confirmation timeout', {
        sponsorshipRequestId,
        relayTransactionId,
        transactionHash: null,
        elapsedMs,
      })

      return {
        success: false,
        transactionHash: null,
        failureReason: 'Transaction confirmation timeout',
        blockNumber: null,
        explorerUrl: null,
        eventData: null,
      }
    }

    const message = error instanceof Error ? error.message : String(error)

    logger.error('Relay execution outcome', {
      sponsorshipRequestId,
      relayTransactionId,
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
      explorerUrl: null,
      eventData: null,
    }
  }
}

/**
 * Wraps executeContractRelay with abort signal support.
 * If the signal is aborted before the relay completes, throws an AbortError.
 */
async function executeContractRelayWithAbort(
  walletAddress: `0x${string}`,
  amount: bigint,
  context: { sponsorshipRequestId: string; relayTransactionId: string; relayAttempt?: number },
  signal: AbortSignal
): Promise<Awaited<ReturnType<typeof executeContractRelay>>> {
  // If already aborted before we start, throw immediately
  if (signal.aborted) {
    const err = new Error('Transaction confirmation timeout')
    err.name = 'AbortError'
    throw err
  }

  // Race the contract relay against the abort signal
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const err = new Error('Transaction confirmation timeout')
      err.name = 'AbortError'
      reject(err)
    }

    signal.addEventListener('abort', onAbort, { once: true })

    executeContractRelay(walletAddress, amount, context)
      .then((result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}
