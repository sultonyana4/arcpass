import { prisma } from '@arcpass/shared'
import { SponsorshipNotFoundError } from '../lib/errors.js'

/**
 * Creates a new relay transaction record for a sponsorship request.
 * Automatically determines the next relay attempt number.
 *
 * @param {string} sponsorshipRequestId - The sponsorship request UUID
 * @returns {Promise<object>} The created relay transaction record
 */
export async function createRelayTransaction(sponsorshipRequestId) {
  const lastAttempt = await prisma.relayTransaction.findFirst({
    where: { sponsorshipRequestId },
    orderBy: { relayAttempt: 'desc' },
    select: { relayAttempt: true },
  })

  const nextAttempt = lastAttempt ? lastAttempt.relayAttempt + 1 : 1

  const relayTransaction = await prisma.relayTransaction.create({
    data: {
      sponsorshipRequestId,
      status: 'queued',
      relayAttempt: nextAttempt,
    },
  })

  return relayTransaction
}

/**
 * Updates the status of a relay transaction.
 * Sets appropriate timestamps based on the new status.
 *
 * @param {string} relayTransactionId - The relay transaction UUID
 * @param {object} params
 * @param {string} params.status - New status (queued, submitted, confirmed, failed)
 * @param {string} [params.transactionHash] - The on-chain transaction hash
 * @param {string} [params.failureReason] - Reason for failure (when status is 'failed')
 * @returns {Promise<object>} The updated relay transaction record
 */
export async function updateRelayStatus(relayTransactionId, { status, transactionHash, failureReason }) {
  const data = { status }

  if (transactionHash) {
    data.transactionHash = transactionHash
  }

  if (failureReason) {
    data.failureReason = failureReason
  }

  if (status === 'submitted') {
    data.submittedAt = new Date()
  } else if (status === 'confirmed') {
    data.confirmedAt = new Date()
  } else if (status === 'failed') {
    data.failedAt = new Date()
  }

  const relayTransaction = await prisma.relayTransaction.update({
    where: { id: relayTransactionId },
    data,
  })

  return relayTransaction
}

/**
 * Retrieves all relay transactions for a sponsorship request,
 * ordered by relay attempt number (ascending).
 *
 * @param {string} sponsorshipRequestId - The sponsorship request UUID
 * @returns {Promise<object[]>} Array of relay transaction records
 */
export async function getRelayTransactions(sponsorshipRequestId) {
  const relayTransactions = await prisma.relayTransaction.findMany({
    where: { sponsorshipRequestId },
    orderBy: { relayAttempt: 'asc' },
  })

  return relayTransactions
}

/**
 * Retrieves a relay transaction by its UUID.
 *
 * @param {string} id - The relay transaction UUID
 * @returns {Promise<object|null>} The relay transaction record or null if not found
 */
export async function getRelayById(id) {
  const relay = await prisma.relayTransaction.findUnique({
    where: { id },
    select: {
      id: true,
      sponsorshipRequestId: true,
      status: true,
      relayAttempt: true,
      transactionHash: true,
      submittedAt: true,
      confirmedAt: true,
      failedAt: true,
      failureReason: true,
    },
  })

  return relay
}


/**
 * Looks up a relay transaction by its on-chain transaction hash.
 * Returns the relay transaction along with its associated sponsorship request.
 *
 * @param {string} transactionHash - The on-chain transaction hash
 * @returns {Promise<object>} Object containing sponsorshipRequest and relayTransaction
 * @throws {SponsorshipNotFoundError} if no relay transaction matches the hash
 */
export async function getRelayTransactionByHash(transactionHash) {
  const relayTransaction = await prisma.relayTransaction.findUnique({
    where: { transactionHash },
    include: { sponsorshipRequest: true },
  })

  if (!relayTransaction) {
    throw new SponsorshipNotFoundError('Transaction not found')
  }

  const { sponsorshipRequest, ...relayDetails } = relayTransaction

  return {
    sponsorshipRequest,
    relayTransaction: relayDetails,
  }
}
