import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@arcpass/shared', () => ({
  prisma: {
    wallet: {
      findUnique: vi.fn(),
    },
    sponsorshipRequest: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from '@arcpass/shared'
import {
  validateWalletExists,
  validateWalletNotBlocked,
  validateNoPendingRequest,
} from '../src/lib/sponsorship-validation.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateWalletExists', () => {
  it('returns the wallet when it exists', async () => {
    const mockWallet = { id: 'wallet-1', walletAddress: '0xabc', isBlocked: false }
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)

    const result = await validateWalletExists('0xabc')

    expect(result).toEqual(mockWallet)
    expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
      where: { walletAddress: '0xabc' },
    })
  })

  it('throws WalletNotFoundError when wallet does not exist', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null)

    await expect(validateWalletExists('0xnonexistent')).rejects.toThrow('Wallet not found')
    await expect(validateWalletExists('0xnonexistent')).rejects.toMatchObject({
      name: 'WalletNotFoundError',
    })
  })

  it('throws WalletNotFoundError for empty string address', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null)

    await expect(validateWalletExists('')).rejects.toThrow('Wallet not found')
    expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
      where: { walletAddress: '' },
    })
  })

  it('passes the wallet address as-is to the database (case-sensitive lookup)', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null)

    await expect(validateWalletExists('0xABC')).rejects.toThrow('Wallet not found')
    expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
      where: { walletAddress: '0xABC' },
    })
  })
})

describe('validateWalletNotBlocked', () => {
  it('does not throw when wallet is not blocked', () => {
    const wallet = { id: 'wallet-1', isBlocked: false }

    expect(() => validateWalletNotBlocked(wallet)).not.toThrow()
  })

  it('throws BlockedWalletError when wallet is blocked', () => {
    const wallet = { id: 'wallet-1', isBlocked: true }

    expect(() => validateWalletNotBlocked(wallet)).toThrow('Wallet is blocked')

    try {
      validateWalletNotBlocked(wallet)
    } catch (err) {
      expect(err.name).toBe('BlockedWalletError')
    }
  })

  it('does not throw when isBlocked is undefined (defaults to falsy)', () => {
    const wallet = { id: 'wallet-1' }

    expect(() => validateWalletNotBlocked(wallet)).not.toThrow()
  })

  it('does not throw when isBlocked is null (falsy)', () => {
    const wallet = { id: 'wallet-1', isBlocked: null }

    expect(() => validateWalletNotBlocked(wallet)).not.toThrow()
  })
})

describe('validateNoPendingRequest', () => {
  it('does not throw when no pending request exists', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValue(null)

    await expect(validateNoPendingRequest('wallet-1')).resolves.not.toThrow()
    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-1',
        status: 'pending',
      },
    })
  })

  it('throws ValidationError when a pending request exists', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      walletId: 'wallet-1',
      status: 'pending',
    })

    await expect(validateNoPendingRequest('wallet-1')).rejects.toThrow(
      'Wallet already has a pending sponsorship request'
    )
    await expect(validateNoPendingRequest('wallet-1')).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('queries with the exact walletId provided', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValue(null)

    await validateNoPendingRequest('some-uuid-123')

    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenCalledWith({
      where: {
        walletId: 'some-uuid-123',
        status: 'pending',
      },
    })
  })

  it('only checks for pending status, not approved/completed/rejected requests', async () => {
    // Simulate no pending request found (even if approved/completed ones exist)
    prisma.sponsorshipRequest.findFirst.mockResolvedValue(null)

    await expect(validateNoPendingRequest('wallet-1')).resolves.not.toThrow()

    // Verify the query specifically filters by 'pending' status
    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-1',
        status: 'pending',
      },
    })
  })

  it('blocks only when status is pending, not other terminal statuses', async () => {
    // First call: no pending request (wallet has approved/completed requests but not pending)
    prisma.sponsorshipRequest.findFirst.mockResolvedValue(null)
    await expect(validateNoPendingRequest('wallet-with-history')).resolves.not.toThrow()

    // Second call: pending request exists - should block
    prisma.sponsorshipRequest.findFirst.mockResolvedValue({
      id: 'req-2',
      walletId: 'wallet-with-history',
      status: 'pending',
    })
    await expect(validateNoPendingRequest('wallet-with-history')).rejects.toThrow(
      'Wallet already has a pending sponsorship request'
    )
  })
})
