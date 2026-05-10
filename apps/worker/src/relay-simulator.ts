import { randomBytes, createHash } from 'node:crypto'

export interface RelayResult {
  success: boolean
  transactionHash: string | null
  failureReason: string | null
}

/**
 * Simulates a blockchain relay call for a sponsorship request.
 *
 * Generates a deterministic-prefix transaction hash on success,
 * or returns a failure reason based on the configured failure rate.
 */
export async function simulateRelay(
  sponsorshipRequestId: string,
  failureRate: number = 0.0
): Promise<RelayResult> {
  if (!sponsorshipRequestId || sponsorshipRequestId.trim() === '') {
    throw new Error('A valid sponsorship request ID is required')
  }

  const shouldFail = Math.random() < failureRate

  if (shouldFail) {
    return {
      success: false,
      transactionHash: null,
      failureReason: `Simulated relay failure for request ${sponsorshipRequestId}`,
    }
  }

  const transactionHash = generateTransactionHash(sponsorshipRequestId)

  return {
    success: true,
    transactionHash,
    failureReason: null,
  }
}

/**
 * Generates a mock transaction hash:
 * - First 8 hex chars are derived deterministically from the request ID
 * - Remaining 56 hex chars are randomly generated
 */
function generateTransactionHash(requestId: string): string {
  const hash = createHash('sha256').update(requestId).digest('hex')
  const deterministicPrefix = hash.slice(0, 8)
  const randomSuffix = randomBytes(28).toString('hex')

  return `0x${deterministicPrefix}${randomSuffix}`
}
