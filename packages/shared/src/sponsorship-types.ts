/**
 * Shared sponsorship types and constants for use by both the API
 * and future async workers (queue processors, relay workers, etc.).
 *
 * This module is the single source of truth for sponsorship lifecycle
 * definitions. Workers import from here to validate transitions and
 * construct payloads without coupling to HTTP layer code.
 */

// --- Status Constants ---

export const SponsorshipStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RELAYED: 'relayed',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type SponsorshipStatusValue =
  (typeof SponsorshipStatus)[keyof typeof SponsorshipStatus]

export const RelayStatus = {
  QUEUED: 'queued',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const

export type RelayStatusValue = (typeof RelayStatus)[keyof typeof RelayStatus]

// --- Valid Status Transitions ---

/**
 * Maps a sponsorship request's current status to the set of statuses
 * it is allowed to transition into. Workers MUST check this before
 * attempting a status update.
 */
export const VALID_SPONSORSHIP_TRANSITIONS: Record<
  SponsorshipStatusValue,
  readonly SponsorshipStatusValue[]
> = {
  pending: ['approved', 'rejected'],
  approved: ['relayed'],
  relayed: ['completed', 'failed'],
  rejected: [],
  completed: [],
  failed: [],
} as const

/**
 * Maps a relay transaction's current status to the set of statuses
 * it is allowed to transition into.
 */
export const VALID_RELAY_TRANSITIONS: Record<
  RelayStatusValue,
  readonly RelayStatusValue[]
> = {
  queued: ['submitted', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  failed: [],
} as const

// --- Payload Type Definitions ---

/** Payload a worker receives when processing a sponsorship request. */
export interface SponsorshipRequestPayload {
  sponsorshipRequestId: string
  walletId: string
  walletAddress: string
  status: SponsorshipStatusValue
  requestedAt: string // ISO 8601
  ipAddress: string | null
  userAgent: string | null
}

/** Payload a worker uses to update sponsorship status. */
export interface SponsorshipStatusUpdatePayload {
  sponsorshipRequestId: string
  newStatus: SponsorshipStatusValue
}

/** Payload a worker uses to create a relay transaction. */
export interface RelayTransactionCreatePayload {
  sponsorshipRequestId: string
}

/** Payload a worker uses to update relay transaction status. */
export interface RelayStatusUpdatePayload {
  relayTransactionId: string
  status: RelayStatusValue
  transactionHash?: string
  failureReason?: string
}

// --- Utility Functions ---

/**
 * Checks whether a sponsorship status transition is valid.
 * Workers should call this before attempting an update.
 */
export function isValidSponsorshipTransition(
  currentStatus: SponsorshipStatusValue,
  newStatus: SponsorshipStatusValue
): boolean {
  const allowed = VALID_SPONSORSHIP_TRANSITIONS[currentStatus]
  return allowed.includes(newStatus)
}

/**
 * Checks whether a relay status transition is valid.
 */
export function isValidRelayTransition(
  currentStatus: RelayStatusValue,
  newStatus: RelayStatusValue
): boolean {
  const allowed = VALID_RELAY_TRANSITIONS[currentStatus]
  return allowed.includes(newStatus)
}
