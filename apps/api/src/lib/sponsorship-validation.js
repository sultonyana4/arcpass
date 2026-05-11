import { prisma } from '@arcpass/shared'
import { WalletNotFoundError, BlockedWalletError, ValidationError } from './errors.js'

/**
 * Validates that a wallet exists in the database by address.
 * @param {string} walletAddress - The normalized wallet address to look up
 * @returns {Promise<object>} The wallet record if found
 * @throws {WalletNotFoundError} if no wallet exists with the given address
 */
export async function validateWalletExists(walletAddress) {
  const wallet = await prisma.wallet.findUnique({
    where: { walletAddress },
  })

  if (!wallet) {
    throw new WalletNotFoundError('Wallet not found')
  }

  return wallet
}

/**
 * Validates that a wallet is not blocked.
 * @param {object} wallet - The wallet record to check
 * @throws {BlockedWalletError} if the wallet is blocked
 */
export function validateWalletNotBlocked(wallet) {
  if (wallet.isBlocked) {
    throw new BlockedWalletError('Wallet is blocked')
  }
}

/**
 * Validates that a wallet is eligible for a new sponsorship request.
 *
 * Rejection rules:
 * - If any sponsorship in `pending`, `approved`, or `relayed` status exists → 400 "sponsorship already in progress"
 * - If any `completed` sponsorship exists → 400 "wallet has already been sponsored"
 * - Allow new request only if most recent is `failed`/`rejected` with no `completed`
 *
 * For concurrent submissions, the processor uses row-level locking (SELECT FOR UPDATE SKIP LOCKED),
 * so this API-side validation checks current state as a first line of defense.
 *
 * @param {string} walletId - The wallet ID to check
 * @throws {ValidationError} if the wallet is not eligible for a new sponsorship
 */
export async function validateNoPendingRequest(walletId) {
  const activeRequest = await prisma.sponsorshipRequest.findFirst({
    where: {
      walletId,
      status: { in: ['pending', 'approved', 'relayed'] },
    },
  })

  if (activeRequest) {
    throw new ValidationError('sponsorship already in progress')
  }

  const completedRequest = await prisma.sponsorshipRequest.findFirst({
    where: {
      walletId,
      status: 'completed',
    },
  })

  if (completedRequest) {
    throw new ValidationError('wallet has already been sponsored')
  }
}
