import { prisma } from '@arcpass/shared'
import { normalizeWalletAddress } from '../lib/wallet-validation.js'
import { BlockedWalletError } from '../lib/errors.js'

/**
 * Registers a wallet address. Creates a new record or updates an existing one.
 * @param {string} rawAddress - The raw wallet address to register
 * @returns {Promise<{ wallet: object, isNew: boolean }>} The wallet record and whether it's new
 * @throws {BlockedWalletError} if the wallet is blocked
 * @throws {ValidationError} if the address format is invalid
 */
export async function registerWallet(rawAddress) {
  const normalized = normalizeWalletAddress(rawAddress)

  const existing = await prisma.wallet.findUnique({
    where: { walletAddress: normalized },
  })

  if (!existing) {
    const wallet = await prisma.wallet.create({
      data: {
        walletAddress: normalized,
      },
    })
    return { wallet, isNew: true }
  }

  if (existing.isBlocked) {
    throw new BlockedWalletError('Wallet is blocked')
  }

  const wallet = await prisma.wallet.update({
    where: { walletAddress: normalized },
    data: {
      lastSeenAt: new Date(),
      sponsorshipCount: { increment: 1 },
    },
  })

  return { wallet, isNew: false }
}

/**
 * Looks up a wallet by address. Read-only — does not modify any fields.
 * @param {string} rawAddress - The raw wallet address to look up
 * @returns {Promise<object|null>} The wallet record or null if not found
 * @throws {ValidationError} if the address format is invalid
 */
export async function lookupWallet(rawAddress) {
  const normalized = normalizeWalletAddress(rawAddress)

  const wallet = await prisma.wallet.findUnique({
    where: { walletAddress: normalized },
  })

  return wallet
}
