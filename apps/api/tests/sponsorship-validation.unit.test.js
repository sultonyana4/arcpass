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
  it('rejects with "sponsorship already in progress" when a pending request exists', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      walletId: 'wallet-1',
      status: 'pending',
    })

    const error = await validateNoPendingRequest('wallet-1').catch((e) => e)
    expect(error.message).toBe('sponsorship already in progress')
    expect(error.name).toBe('ValidationError')
  })

  it('rejects with "sponsorship already in progress" when an approved request exists', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce({
      id: 'req-2',
      walletId: 'wallet-1',
      status: 'approved',
    })

    const error = await validateNoPendingRequest('wallet-1').catch((e) => e)
    expect(error.message).toBe('sponsorship already in progress')
    expect(error.name).toBe('ValidationError')
  })

  it('rejects with "sponsorship already in progress" when a relayed request exists', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce({
      id: 'req-3',
      walletId: 'wallet-1',
      status: 'relayed',
    })

    const error = await validateNoPendingRequest('wallet-1').catch((e) => e)
    expect(error.message).toBe('sponsorship already in progress')
    expect(error.name).toBe('ValidationError')
  })

  it('rejects with "wallet has already been sponsored" when a completed request exists', async () => {
    // No active request found
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)
    // But a completed request exists
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce({
      id: 'req-4',
      walletId: 'wallet-1',
      status: 'completed',
    })

    const error = await validateNoPendingRequest('wallet-1').catch((e) => e)
    expect(error.message).toBe('wallet has already been sponsored')
    expect(error.name).toBe('ValidationError')
  })

  it('allows new request when no active or completed sponsorships exist', async () => {
    // No active request
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)
    // No completed request
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)

    await expect(validateNoPendingRequest('wallet-1')).resolves.not.toThrow()
  })

  it('allows new request when most recent is failed (no completed exists)', async () => {
    // No active request
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)
    // No completed request
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)

    await expect(validateNoPendingRequest('wallet-with-failed')).resolves.not.toThrow()
  })

  it('allows new request when most recent is rejected (no completed exists)', async () => {
    // No active request
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)
    // No completed request
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)

    await expect(validateNoPendingRequest('wallet-with-rejected')).resolves.not.toThrow()
  })

  it('queries for active statuses (pending, approved, relayed) first', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)

    await validateNoPendingRequest('wallet-1')

    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        walletId: 'wallet-1',
        status: { in: ['pending', 'approved', 'relayed'] },
      },
    })
  })

  it('queries for completed status second', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)

    await validateNoPendingRequest('wallet-1')

    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        walletId: 'wallet-1',
        status: 'completed',
      },
    })
  })

  it('does not check completed status if active request is found', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      walletId: 'wallet-1',
      status: 'pending',
    })

    try {
      await validateNoPendingRequest('wallet-1')
    } catch {
      // expected
    }

    // Should only have been called once (for active check)
    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenCalledTimes(1)
  })

  it('queries with the exact walletId provided', async () => {
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)
    prisma.sponsorshipRequest.findFirst.mockResolvedValueOnce(null)

    await validateNoPendingRequest('some-uuid-123')

    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        walletId: 'some-uuid-123',
        status: { in: ['pending', 'approved', 'relayed'] },
      },
    })
    expect(prisma.sponsorshipRequest.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        walletId: 'some-uuid-123',
        status: 'completed',
      },
    })
  })
})
