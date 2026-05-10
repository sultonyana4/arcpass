import {
  type PrismaClient,
  type SponsorshipStatusValue,
  type RelayStatusValue,
  VALID_SPONSORSHIP_TRANSITIONS,
  VALID_RELAY_TRANSITIONS,
} from '@arcpass/shared'
import { createLogger } from './logger.js'

const logger = createLogger('lifecycle')

export interface TransitionResult {
  success: boolean
  error?: string
}

/**
 * Map of sponsorship statuses to their corresponding timestamp fields.
 * Only statuses that set a timestamp are included.
 */
const STATUS_TIMESTAMP_FIELD: Partial<Record<SponsorshipStatusValue, string>> = {
  approved: 'approvedAt',
  rejected: 'rejectedAt',
  completed: 'completedAt',
  failed: 'failedAt',
}

/**
 * Transitions a sponsorship request to a new status, validating against
 * VALID_SPONSORSHIP_TRANSITIONS and setting the appropriate timestamp.
 *
 * - Rejects invalid transitions without modifying the request.
 * - Preserves all previously set timestamp fields unchanged.
 * - Sets the timestamp for the new status using current UTC time with millisecond precision.
 */
export async function transitionSponsorshipStatus(
  tx: PrismaClient,
  requestId: string,
  newStatus: SponsorshipStatusValue
): Promise<TransitionResult> {
  // Fetch the current request to validate the transition
  const request = await tx.sponsorshipRequest.findUnique({
    where: { id: requestId },
  })

  if (!request) {
    return { success: false, error: 'Request not found' }
  }

  const currentStatus = request.status as SponsorshipStatusValue
  const allowedTransitions = VALID_SPONSORSHIP_TRANSITIONS[currentStatus]

  if (!allowedTransitions.includes(newStatus)) {
    logger.warn('Invalid sponsorship status transition attempted', {
      sponsorshipRequestId: requestId,
      previousStatus: currentStatus,
      attemptedStatus: newStatus,
      reason: `Invalid transition from "${currentStatus}" to "${newStatus}"`,
    })
    return {
      success: false,
      error: `Invalid transition from "${currentStatus}" to "${newStatus}"`,
    }
  }

  // Build the update data — only set the timestamp for the new status
  const updateData: Record<string, unknown> = { status: newStatus }

  const timestampField = STATUS_TIMESTAMP_FIELD[newStatus]
  if (timestampField) {
    updateData[timestampField] = new Date()
  }

  await tx.sponsorshipRequest.update({
    where: { id: requestId },
    data: updateData,
  })

  return { success: true }
}

/**
 * Maximum number of relay attempts allowed per sponsorship request.
 */
const MAX_RELAY_ATTEMPTS = 3

/**
 * Map of relay statuses to their corresponding timestamp fields.
 */
const RELAY_STATUS_TIMESTAMP_FIELD: Partial<Record<RelayStatusValue, string>> = {
  submitted: 'submittedAt',
  confirmed: 'confirmedAt',
  failed: 'failedAt',
}

/**
 * Creates a new relay transaction for a sponsorship request.
 *
 * - Sets `relayAttempt` to the previous highest attempt + 1.
 * - Enforces a maximum of 3 relay attempts per request.
 * - Throws an error if the maximum relay attempts have been reached.
 */
export async function createRelayTransaction(
  tx: PrismaClient,
  sponsorshipRequestId: string
): Promise<{ id: string; relayAttempt: number }> {
  // Count existing relay transactions for this request
  const existingCount = await tx.relayTransaction.count({
    where: { sponsorshipRequestId },
  })

  if (existingCount >= MAX_RELAY_ATTEMPTS) {
    throw new Error(
      `Maximum relay attempts (${MAX_RELAY_ATTEMPTS}) reached for request ${sponsorshipRequestId}`
    )
  }

  const relayAttempt = existingCount + 1

  const relayTransaction = await tx.relayTransaction.create({
    data: {
      sponsorshipRequestId,
      relayAttempt,
      status: 'queued',
    },
  })

  return { id: relayTransaction.id, relayAttempt }
}

/**
 * Updates a relay transaction's status with transition validation.
 *
 * - Validates the transition against VALID_RELAY_TRANSITIONS.
 * - Sets the appropriate timestamp on valid transitions:
 *   - `submittedAt` on queued→submitted
 *   - `confirmedAt` on submitted→confirmed
 *   - `failedAt` on →failed
 * - Stores `transactionHash` or `failureReason` from the data param.
 * - Stores `blockNumber`, `eventName`, and `eventData` when provided (for confirmed relays).
 * - Rejects invalid transitions and preserves existing state.
 */
export async function updateRelayTransaction(
  tx: PrismaClient,
  relayTransactionId: string,
  status: RelayStatusValue,
  data?: {
    transactionHash?: string
    failureReason?: string
    blockNumber?: bigint | null
    eventName?: string | null
    eventData?: Record<string, unknown> | null
  }
): Promise<TransitionResult> {
  const relayTransaction = await tx.relayTransaction.findUnique({
    where: { id: relayTransactionId },
  })

  if (!relayTransaction) {
    return { success: false, error: 'Relay transaction not found' }
  }

  const currentStatus = relayTransaction.status as RelayStatusValue
  const allowedTransitions = VALID_RELAY_TRANSITIONS[currentStatus]

  if (!allowedTransitions.includes(status)) {
    logger.warn('Invalid relay status transition attempted', {
      sponsorshipRequestId: relayTransaction.sponsorshipRequestId,
      previousStatus: currentStatus,
      attemptedStatus: status,
      reason: `Invalid relay transition from "${currentStatus}" to "${status}"`,
    })
    return {
      success: false,
      error: `Invalid relay transition from "${currentStatus}" to "${status}"`,
    }
  }

  // Build the update data
  const updateData: Record<string, unknown> = { status }

  // Set the appropriate timestamp
  const timestampField = RELAY_STATUS_TIMESTAMP_FIELD[status]
  if (timestampField) {
    updateData[timestampField] = new Date()
  }

  // Set optional data fields
  if (data?.transactionHash) {
    updateData.transactionHash = data.transactionHash
  }
  if (data?.failureReason) {
    updateData.failureReason = data.failureReason
  }
  if (data?.blockNumber !== undefined) {
    updateData.blockNumber = data.blockNumber
  }
  if (data?.eventName !== undefined) {
    updateData.eventName = data.eventName
  }
  if (data?.eventData !== undefined) {
    updateData.eventData = data.eventData
  }

  await tx.relayTransaction.update({
    where: { id: relayTransactionId },
    data: updateData,
  })

  return { success: true }
}

/**
 * Returns the number of relay transactions (processing attempts)
 * for a given sponsorship request.
 */
export async function getRetryCount(
  tx: PrismaClient,
  requestId: string
): Promise<number> {
  return tx.relayTransaction.count({
    where: { sponsorshipRequestId: requestId },
  })
}
