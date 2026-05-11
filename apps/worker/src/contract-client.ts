import { decodeEventLog, decodeErrorResult } from 'viem'
import type { Abi, TransactionReceipt } from 'viem'
import type { ViemClients } from './viem-client.js'
import { createLogger } from './logger.js'
import type { LogEntry } from './logger.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContractConfig {
  sponsorVaultAddress: `0x${string}`
  sponsorshipRegistryAddress: `0x${string}`
  sponsorVaultAbi: Abi
  sponsorshipRegistryAbi: Abi
}

export interface ContractRelayResult {
  success: boolean
  transactionHash: string | null
  blockNumber: bigint | null
  failureReason: string | null
  explorerUrl: string | null
  eventData: {
    recipient: string
    amount: bigint
    timestamp: bigint
  } | null
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let clients: ViemClients | null = null
let config: ContractConfig | null = null
let timeoutMs: number = 120_000
let explorerBaseUrl: string = 'https://testnet.arcscan.app/tx/'

const logger = createLogger('contract-client' as LogEntry['component'])

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Stores viem clients, contract configuration, and timeout in module-level state.
 * Must be called once at worker startup before calling `executeContractRelay`.
 */
export function initializeContractClient(
  viemClients: ViemClients,
  contractConfig: ContractConfig,
  configuredTimeoutMs: number,
  configuredExplorerBaseUrl: string
): void {
  clients = viemClients
  config = contractConfig
  timeoutMs = configuredTimeoutMs
  explorerBaseUrl = configuredExplorerBaseUrl
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a full explorer URL for a given transaction hash.
 */
function buildExplorerUrl(hash: string): string {
  return `${explorerBaseUrl}${hash}`
}

// ---------------------------------------------------------------------------
// Relay execution
// ---------------------------------------------------------------------------

/**
 * Optional context passed to executeContractRelay for structured logging.
 */
export interface RelayContext {
  sponsorshipRequestId?: string
  relayTransactionId?: string
  relayAttempt?: number
}

export async function executeContractRelay(
  recipientAddress: `0x${string}`,
  amount: bigint,
  context?: RelayContext | string
): Promise<ContractRelayResult> {
  // Support legacy call signature where third arg was sponsorshipRequestId string
  const resolvedContext: RelayContext = typeof context === 'string'
    ? { sponsorshipRequestId: context }
    : context ?? {}

  if (!clients || !config) {
    return {
      success: false,
      transactionHash: null,
      blockNumber: null,
      failureReason: 'Contract client not initialized — call initializeContractClient() first',
      explorerUrl: null,
      eventData: null,
    }
  }

  const { publicClient, walletClient, account } = clients
  const {
    sponsorVaultAddress,
    sponsorVaultAbi,
    sponsorshipRegistryAbi,
  } = config

  let hash: `0x${string}` | null = null
  const startTime = Date.now()

  // Log relay attempt start
  logger.info('Relay attempt started', {
    sponsorshipRequestId: resolvedContext.sponsorshipRequestId ?? null,
    relayAttempt: resolvedContext.relayAttempt ?? null,
    recipient: recipientAddress,
    amount: amount.toString(),
  })

  try {
    // Step 1: Call SponsorVault.sponsorTransfer via writeContract
    hash = await walletClient.writeContract({
      account,
      address: sponsorVaultAddress,
      abi: sponsorVaultAbi,
      functionName: 'sponsorTransfer',
      args: [recipientAddress, amount],
      chain: null,
    })

    logger.info('Contract transaction broadcast', {
      sponsorshipRequestId: resolvedContext.sponsorshipRequestId ?? null,
      relayAttempt: resolvedContext.relayAttempt ?? null,
      transactionHash: hash,
      recipient: recipientAddress,
      amount: amount.toString(),
    })

    // Step 2: Wait for receipt with configured confirmations and timeout
    const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: timeoutMs,
    })

    // Step 3: Check receipt status
    if (receipt.status === 'success') {
      // Extract SponsorshipGranted event from receipt logs
      const eventData = extractSponsorshipGrantedEvent(receipt, sponsorshipRegistryAbi)

      logger.info('Relay outcome', {
        sponsorshipRequestId: resolvedContext.sponsorshipRequestId ?? null,
        relayAttempt: resolvedContext.relayAttempt ?? null,
        transactionHash: hash,
        outcome: 'confirmed',
        blockNumber: receipt.blockNumber.toString(),
        elapsedMs: Date.now() - startTime,
      })

      return {
        success: true,
        transactionHash: hash,
        blockNumber: receipt.blockNumber,
        failureReason: null,
        explorerUrl: buildExplorerUrl(hash),
        eventData,
      }
    }

    // Step 4: Transaction reverted — decode revert reason
    const failureReason = truncateReason(decodeRevertReason(receipt, sponsorVaultAbi))
    const elapsedMs = Date.now() - startTime

    logger.error('Relay outcome', {
      sponsorshipRequestId: resolvedContext.sponsorshipRequestId ?? null,
      relayAttempt: resolvedContext.relayAttempt ?? null,
      transactionHash: hash,
      outcome: 'reverted',
      failureReason,
      relayStage: 'receipt',
      elapsedMs,
    })

    return {
      success: false,
      transactionHash: hash,
      blockNumber: receipt.blockNumber,
      failureReason,
      explorerUrl: null,
      eventData: null,
    }
  } catch (error) {
    // Step 5: Handle timeout, network errors, or writeContract revert
    const failureReason = handleExecutionError(error, config.sponsorVaultAbi)
    const elapsedMs = Date.now() - startTime

    logger.error('Relay outcome', {
      sponsorshipRequestId: resolvedContext.sponsorshipRequestId ?? null,
      relayAttempt: resolvedContext.relayAttempt ?? null,
      transactionHash: hash,
      outcome: 'error',
      failureReason: truncateReason(failureReason),
      relayStage: hash ? 'receipt' : 'broadcast',
      elapsedMs,
    })

    return {
      success: false,
      transactionHash: hash,
      blockNumber: null,
      failureReason: truncateReason(failureReason),
      explorerUrl: null,
      eventData: null,
    }
  }
}

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the SponsorshipGranted event from a transaction receipt's logs.
 * Uses viem's `decodeEventLog` with the SponsorshipRegistry ABI.
 *
 * Returns null if the event is not found in the receipt logs.
 */
export function extractSponsorshipGrantedEvent(
  receipt: TransactionReceipt,
  registryAbi: Abi
): ContractRelayResult['eventData'] {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: registryAbi,
        data: log.data,
        topics: (log as unknown as { topics: [`0x${string}`, ...`0x${string}`[]] }).topics,
      })

      if (decoded.eventName === 'SponsorshipGranted') {
        const args = decoded.args as unknown as {
          recipient: string
          amount: bigint
          timestamp: bigint
        }

        return {
          recipient: args.recipient,
          amount: args.amount,
          timestamp: args.timestamp,
        }
      }
    } catch {
      // Log entry doesn't match registry ABI — skip
      continue
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Revert reason decoding
// ---------------------------------------------------------------------------

/**
 * Attempts to decode a revert reason from a reverted transaction.
 * Uses viem's `decodeErrorResult` with the SponsorVault ABI to decode
 * known custom errors (Unauthorized, ExceedsLimit, InsufficientBalance, AlreadySponsored, etc.).
 *
 * Returns a human-readable failure reason string.
 */
export function decodeRevertReason(
  receipt: TransactionReceipt,
  vaultAbi: Abi
): string {
  // For reverted transactions, the revert data may not be directly available
  // in the receipt. Return a generic revert message.
  // The actual revert decoding happens in the catch block when writeContract throws.
  return 'Transaction reverted on-chain'
}

/**
 * Handles errors thrown during contract execution (writeContract or waitForTransactionReceipt).
 * Detects specific network error patterns and attempts to decode known custom errors.
 */
export function handleExecutionError(error: unknown, vaultAbi: Abi): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const msg = error.message.toLowerCase()

  // Check for connection timeout/refused errors
  if (msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('connect')) {
    return `Connection error: ${error.message}`
  }

  // Check for HTTP 429 rate limiting
  if (msg.includes('429') || msg.includes('rate limit')) {
    return `RPC rate limited: ${error.message}`
  }

  // Check for nonce-too-low errors
  if (msg.includes('nonce')) {
    return `Nonce error: ${error.message}`
  }

  // Check for gas estimation failures
  if (msg.includes('gas')) {
    return `Gas estimation failed: ${error.message}`
  }

  // Check for timeout errors (waitForTransactionReceipt timeout)
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Transaction confirmation timeout'
  }

  // Attempt to decode custom contract errors from the error data
  const errorData = extractErrorData(error)
  if (errorData) {
    try {
      const decoded = decodeErrorResult({
        abi: vaultAbi,
        data: errorData,
      })

      return formatDecodedError(decoded)
    } catch {
      // Error data exists but doesn't match any known selector — use generic revert message
      return 'Transaction reverted on-chain'
    }
  }

  return error.message
}

/**
 * Extracts hex-encoded error data from a viem contract call error.
 * Viem wraps contract revert data in error objects with various structures.
 */
export function extractErrorData(error: unknown): `0x${string}` | null {
  if (!error || typeof error !== 'object') return null

  // viem ContractFunctionRevertedError stores data in error.data
  const err = error as Record<string, unknown>

  if (err.data && typeof err.data === 'string' && err.data.startsWith('0x')) {
    return err.data as `0x${string}`
  }

  // Some viem errors nest the data under cause
  if (err.cause && typeof err.cause === 'object') {
    return extractErrorData(err.cause)
  }

  // Check for walk pattern in viem errors
  if (err.walk && typeof err.walk === 'function') {
    try {
      const innerError = (err.walk as (fn: (e: unknown) => boolean) => unknown)(
        (e: unknown) => {
          return (
            typeof e === 'object' &&
            e !== null &&
            'data' in e &&
            typeof (e as Record<string, unknown>).data === 'string'
          )
        }
      )
      if (innerError && typeof innerError === 'object' && 'data' in innerError) {
        const data = (innerError as Record<string, unknown>).data
        if (typeof data === 'string' && data.startsWith('0x')) {
          return data as `0x${string}`
        }
      }
    } catch {
      // walk failed — fall through
    }
  }

  return null
}

/**
 * Formats a decoded error result into a human-readable string.
 */
export function formatDecodedError(decoded: { errorName: string; args?: readonly unknown[] }): string {
  const { errorName, args } = decoded

  switch (errorName) {
    case 'Unauthorized':
      return 'Unauthorized: caller is not the operator'
    case 'ExceedsLimit':
      if (args && args.length >= 2) {
        return `ExceedsLimit: requested ${args[0]}, limit ${args[1]}`
      }
      return 'ExceedsLimit: amount exceeds per-transaction limit'
    case 'InsufficientBalance':
      if (args && args.length >= 2) {
        return `InsufficientBalance: requested ${args[0]}, available ${args[1]}`
      }
      return 'InsufficientBalance: vault has insufficient funds'
    case 'AlreadySponsored':
      if (args && args.length >= 1) {
        return `AlreadySponsored: ${args[0]}`
      }
      return 'AlreadySponsored: recipient already sponsored'
    case 'InvalidRecipient':
      return 'InvalidRecipient: recipient address is invalid'
    case 'InvalidAmount':
      return 'InvalidAmount: sponsorship amount is invalid'
    default:
      return `Contract error: ${errorName}`
  }
}

/**
 * Truncates a failure reason string to 1000 characters as required by the spec.
 */
export function truncateReason(reason: string): string {
  if (reason.length <= 1000) return reason
  return reason.slice(0, 997) + '...'
}
