import { prisma } from '@arcpass/shared'
import {
  validateWalletExists,
  validateWalletNotBlocked,
  validateNoPendingRequest,
} from '../lib/sponsorship-validation.js'
import { SponsorshipNotFoundError, InvalidStatusTransitionError } from '../lib/errors.js'

/**
 * Valid status transitions for sponsorship requests.
 * Maps current status → array of allowed next statuses.
 */
const VALID_TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['relayed'],
  relayed: ['completed', 'failed'],
  rejected: [],
  completed: [],
  failed: [],
}

/**
 * Maps status to the timestamp field that should be set on transition.
 */
const STATUS_TIMESTAMP_MAP = {
  approved: 'approvedAt',
  rejected: 'rejectedAt',
  completed: 'completedAt',
  failed: 'failedAt',
}

/**
 * Creates a new sponsorship request for a wallet.
 * Validates eligibility before creating the request.
 *
 * @param {object} params
 * @param {string} params.walletAddress - The normalized wallet address
 * @param {string} [params.ipAddress] - The requester's IP address
 * @param {string} [params.userAgent] - The requester's user agent string
 * @returns {Promise<object>} The created sponsorship request
 * @throws {WalletNotFoundError} if wallet does not exist
 * @throws {BlockedWalletError} if wallet is blocked
 * @throws {ValidationError} if wallet already has a pending request
 */
export async function createSponsorshipRequest({ walletAddress, ipAddress, userAgent }) {
  const wallet = await validateWalletExists(walletAddress)
  validateWalletNotBlocked(wallet)
  await validateNoPendingRequest(wallet.id)

  const sponsorshipRequest = await prisma.sponsorshipRequest.create({
    data: {
      walletId: wallet.id,
      status: 'pending',
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    },
  })

  return sponsorshipRequest
}

/**
 * Retrieves a sponsorship request by ID, including related wallet info.
 *
 * @param {string} requestId - The sponsorship request UUID
 * @returns {Promise<object>} The sponsorship request with wallet relation
 * @throws {SponsorshipNotFoundError} if no request exists with the given ID
 */
export async function getSponsorshipRequest(requestId) {
  const sponsorshipRequest = await prisma.sponsorshipRequest.findUnique({
    where: { id: requestId },
    include: {
      wallet: true,
      relayTransactions: {
        orderBy: { relayAttempt: 'asc' },
        select: {
          id: true,
          status: true,
          relayAttempt: true,
          transactionHash: true,
          submittedAt: true,
          confirmedAt: true,
          failedAt: true,
          failureReason: true,
        },
      },
    },
  })

  if (!sponsorshipRequest) {
    throw new SponsorshipNotFoundError('Sponsorship request not found')
  }

  return sponsorshipRequest
}

/**
 * Retrieves all sponsorship requests currently in 'pending' status.
 * Designed for use by async workers or queue systems to discover work.
 *
 * @param {object} [options]
 * @param {number} [options.limit=50] - Maximum number of records to return
 * @param {string} [options.cursor] - Cursor-based pagination (request ID to start after)
 * @returns {Promise<object[]>} Array of pending sponsorship requests with wallet info
 */
export async function getPendingSponsorshipRequests({ limit = 50, cursor } = {}) {
  const where = { status: 'pending' }

  const findOptions = {
    where,
    include: { wallet: true },
    orderBy: { requestedAt: 'asc' },
    take: limit,
  }

  if (cursor) {
    findOptions.skip = 1
    findOptions.cursor = { id: cursor }
  }

  const requests = await prisma.sponsorshipRequest.findMany(findOptions)
  return requests
}

/**
 * Updates the status of a sponsorship request, enforcing valid transitions.
 * Sets the appropriate timestamp field based on the new status.
 *
 * @param {string} sponsorshipRequestId - The sponsorship request UUID
 * @param {string} newStatus - The target status to transition to
 * @returns {Promise<object>} The updated sponsorship request record
 * @throws {SponsorshipNotFoundError} if no request exists with the given ID
 * @throws {InvalidStatusTransitionError} if the transition is not allowed
 */
export async function updateSponsorshipStatus(sponsorshipRequestId, newStatus) {
  const sponsorshipRequest = await prisma.sponsorshipRequest.findUnique({
    where: { id: sponsorshipRequestId },
  })

  if (!sponsorshipRequest) {
    throw new SponsorshipNotFoundError('Sponsorship request not found')
  }

  const currentStatus = sponsorshipRequest.status
  const allowedTransitions = VALID_TRANSITIONS[currentStatus] || []

  if (!allowedTransitions.includes(newStatus)) {
    throw new InvalidStatusTransitionError(
      `Cannot transition from '${currentStatus}' to '${newStatus}'`
    )
  }

  const data = { status: newStatus }

  const timestampField = STATUS_TIMESTAMP_MAP[newStatus]
  if (timestampField) {
    data[timestampField] = new Date()
  }

  const updated = await prisma.sponsorshipRequest.update({
    where: { id: sponsorshipRequestId },
    data,
  })

  return updated
}
