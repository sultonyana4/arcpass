import { prisma } from '@arcpass/shared'
import { normalizeWalletAddress } from '../lib/wallet-validation.js'
import { BlockedWalletError, WalletNotFoundError } from '../lib/errors.js'

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

/**
 * Retrieves paginated sponsorship history for a wallet.
 * Uses cursor-based pagination with sponsorship request IDs.
 * @param {string} rawAddress - The raw wallet address to look up history for
 * @param {object} options - Pagination options
 * @param {string|null} options.cursor - The ID of the last item from the previous page (optional)
 * @param {number} options.limit - Number of items per page (default 50, max 100)
 * @returns {Promise<{ data: object[], pagination: { cursor: string|null, hasMore: boolean, limit: number } }>}
 * @throws {ValidationError} if the address format is invalid
 * @throws {WalletNotFoundError} if the wallet does not exist
 */
export async function getWalletHistory(rawAddress, { cursor = null, limit = 50 } = {}) {
  const normalized = normalizeWalletAddress(rawAddress)

  // Clamp limit to valid range
  const pageSize = Math.min(Math.max(1, limit), 100)

  const wallet = await prisma.wallet.findUnique({
    where: { walletAddress: normalized },
  })

  if (!wallet) {
    throw new WalletNotFoundError('Wallet not found')
  }

  // Build query conditions
  const where = { walletId: wallet.id }

  // If cursor is provided, fetch records after that cursor
  // We use the cursor ID to find its requestedAt, then fetch older records
  if (cursor) {
    const cursorRecord = await prisma.sponsorshipRequest.findUnique({
      where: { id: cursor },
      select: { requestedAt: true, id: true },
    })

    if (cursorRecord) {
      // Get records that are older than the cursor record
      // Use OR to handle records with the same requestedAt but different IDs
      where.OR = [
        { requestedAt: { lt: cursorRecord.requestedAt } },
        {
          requestedAt: cursorRecord.requestedAt,
          id: { lt: cursorRecord.id },
        },
      ]
    }
  }

  // Fetch one extra record to determine if there are more pages
  const requests = await prisma.sponsorshipRequest.findMany({
    where,
    orderBy: [
      { requestedAt: 'desc' },
      { id: 'desc' },
    ],
    take: pageSize + 1,
  })

  const hasMore = requests.length > pageSize
  const data = hasMore ? requests.slice(0, pageSize) : requests
  const nextCursor = data.length > 0 ? data[data.length - 1].id : null

  return {
    data,
    pagination: {
      cursor: hasMore ? nextCursor : null,
      hasMore,
      limit: pageSize,
    },
  }
}
