import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getWalletHistory } from '../src/services/wallet.service.js'

vi.mock('@arcpass/shared', () => ({
  prisma: {
    wallet: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    sponsorshipRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@arcpass/shared'

describe('getWalletHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockWallet = {
    id: 'wallet-uuid-1',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
  }

  it('returns paginated sponsorship requests for a valid wallet', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)

    const mockRequests = [
      { id: 'req-3', walletId: mockWallet.id, status: 'pending', requestedAt: new Date('2024-03-01') },
      { id: 'req-2', walletId: mockWallet.id, status: 'completed', requestedAt: new Date('2024-02-01') },
    ]
    prisma.sponsorshipRequest.findMany.mockResolvedValue(mockRequests)

    const result = await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678')

    expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
      where: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
    })
    expect(prisma.sponsorshipRequest.findMany).toHaveBeenCalledWith({
      where: { walletId: mockWallet.id },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: 51, // default limit 50 + 1
    })
    expect(result.data).toEqual(mockRequests)
    expect(result.pagination.hasMore).toBe(false)
    expect(result.pagination.cursor).toBe(null)
    expect(result.pagination.limit).toBe(50)
  })

  it('throws WalletNotFoundError when wallet does not exist', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null)

    await expect(
      getWalletHistory('0x1234567890abcdef1234567890abcdef12345678')
    ).rejects.toThrow('Wallet not found')
  })

  it('throws ValidationError for invalid wallet address format', async () => {
    await expect(getWalletHistory('invalid-address')).rejects.toThrow(
      'Invalid wallet address format'
    )
  })

  it('uses default limit of 50 when not specified', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)
    prisma.sponsorshipRequest.findMany.mockResolvedValue([])

    await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678')

    expect(prisma.sponsorshipRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 })
    )
  })

  it('clamps limit to max 100', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)
    prisma.sponsorshipRequest.findMany.mockResolvedValue([])

    await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678', { limit: 200 })

    expect(prisma.sponsorshipRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }) // 100 + 1
    )
  })

  it('clamps limit to min 1', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)
    prisma.sponsorshipRequest.findMany.mockResolvedValue([])

    await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678', { limit: 0 })

    expect(prisma.sponsorshipRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }) // 1 + 1
    )
  })

  it('returns hasMore=true and cursor when more results exist', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)

    // Return 3 items when limit is 2 (2 + 1 extra to detect hasMore)
    const mockRequests = [
      { id: 'req-3', walletId: mockWallet.id, requestedAt: new Date('2024-03-01') },
      { id: 'req-2', walletId: mockWallet.id, requestedAt: new Date('2024-02-01') },
      { id: 'req-1', walletId: mockWallet.id, requestedAt: new Date('2024-01-01') },
    ]
    prisma.sponsorshipRequest.findMany.mockResolvedValue(mockRequests)

    const result = await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678', { limit: 2 })

    expect(result.data).toHaveLength(2)
    expect(result.pagination.hasMore).toBe(true)
    expect(result.pagination.cursor).toBe('req-2')
    expect(result.pagination.limit).toBe(2)
  })

  it('applies cursor-based pagination when cursor is provided', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)

    const cursorDate = new Date('2024-02-15')
    prisma.sponsorshipRequest.findUnique.mockResolvedValue({
      id: 'cursor-id',
      requestedAt: cursorDate,
    })
    prisma.sponsorshipRequest.findMany.mockResolvedValue([])

    await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678', { cursor: 'cursor-id' })

    expect(prisma.sponsorshipRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'cursor-id' },
      select: { requestedAt: true, id: true },
    })
    expect(prisma.sponsorshipRequest.findMany).toHaveBeenCalledWith({
      where: {
        walletId: mockWallet.id,
        OR: [
          { requestedAt: { lt: cursorDate } },
          { requestedAt: cursorDate, id: { lt: 'cursor-id' } },
        ],
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: 51,
    })
  })

  it('ignores invalid cursor (not found in DB)', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)
    prisma.sponsorshipRequest.findUnique.mockResolvedValue(null)
    prisma.sponsorshipRequest.findMany.mockResolvedValue([])

    const result = await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678', { cursor: 'nonexistent-cursor' })

    // Should still query without cursor filter
    expect(prisma.sponsorshipRequest.findMany).toHaveBeenCalledWith({
      where: { walletId: mockWallet.id },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: 51,
    })
    expect(result.pagination.hasMore).toBe(false)
  })

  it('returns empty data array for wallet with no sponsorship requests', async () => {
    prisma.wallet.findUnique.mockResolvedValue(mockWallet)
    prisma.sponsorshipRequest.findMany.mockResolvedValue([])

    const result = await getWalletHistory('0x1234567890abcdef1234567890abcdef12345678')

    expect(result.data).toEqual([])
    expect(result.pagination.cursor).toBe(null)
    expect(result.pagination.hasMore).toBe(false)
    expect(result.pagination.limit).toBe(50)
  })
})
