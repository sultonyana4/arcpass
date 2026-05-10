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
 * Validates that a wallet does not have an active pending sponsorship request.
 * @param {string} walletId - The wallet ID to check
 * @throws {ValidationError} if the wallet already has a pending sponsorship request
 */
export async function validateNoPendingRequest(walletId) {
  const pendingRequest = await prisma.sponsorshipRequest.findFirst({
    where: {
      walletId,
      status: 'pending',
    },
  })

  if (pendingRequest) {
    throw new ValidationError('Wallet already has a pending sponsorship request')
  }
}
