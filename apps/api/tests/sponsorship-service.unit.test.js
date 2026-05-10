import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSponsorshipRequest, getSponsorshipRequest } from '../src/services/sponsorship.service.js'

vi.mock('@arcpass/shared', () => ({
  prisma: {
    sponsorshipRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../src/lib/sponsorship-validation.js', () => ({
  validateWalletExists: vi.fn(),
  validateWalletNotBlocked: vi.fn(),
  validateNoPendingRequest: vi.fn(),
}))

import { prisma } from '@arcpass/shared'
import {
  validateWalletExists,
  validateWalletNotBlocked,
  validateNoPendingRequest,
} from '../src/lib/sponsorship-validation.js'
import { SponsorshipNotFoundError } from '../src/lib/errors.js'

describe('sponsorship.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createSponsorshipRequest', () => {
    const mockWallet = { id: 'wallet-uuid-1', walletAddress: '0xabc123', isBlocked: false }

    it('validates wallet, checks block status, checks pending, then creates request', async () => {
      validateWalletExists.mockResolvedValue(mockWallet)
      validateWalletNotBlocked.mockReturnValue(undefined)
      validateNoPendingRequest.mockResolvedValue(undefined)

      const mockRequest = {
        id: 'req-uuid-1',
        walletId: mockWallet.id,
        status: 'pending',
        ipAddress: '192.168.1.1',
        userAgent: 'TestAgent/1.0',
      }
      prisma.sponsorshipRequest.create.mockResolvedValue(mockRequest)

      const result = await createSponsorshipRequest({
        walletAddress: '0xabc123',
        ipAddress: '192.168.1.1',
        userAgent: 'TestAgent/1.0',
      })

      expect(validateWalletExists).toHaveBeenCalledWith('0xabc123')
      expect(validateWalletNotBlocked).toHaveBeenCalledWith(mockWallet)
      expect(validateNoPendingRequest).toHaveBeenCalledWith(mockWallet.id)
      expect(prisma.sponsorshipRequest.create).toHaveBeenCalledWith({
        data: {
          walletId: mockWallet.id,
          status: 'pending',
          ipAddress: '192.168.1.1',
          userAgent: 'TestAgent/1.0',
        },
      })
      expect(result).toEqual(mockRequest)
    })

    it('stores null for optional audit fields when not provided', async () => {
      validateWalletExists.mockResolvedValue(mockWallet)
      validateWalletNotBlocked.mockReturnValue(undefined)
      validateNoPendingRequest.mockResolvedValue(undefined)
      prisma.sponsorshipRequest.create.mockResolvedValue({ id: 'req-uuid-2' })

      await createSponsorshipRequest({ walletAddress: '0xabc123' })

      expect(prisma.sponsorshipRequest.create).toHaveBeenCalledWith({
        data: {
          walletId: mockWallet.id,
          status: 'pending',
          ipAddress: null,
          userAgent: null,
        },
      })
    })

    it('throws WalletNotFoundError when wallet does not exist', async () => {
      const { WalletNotFoundError } = await import('../src/lib/errors.js')
      validateWalletExists.mockRejectedValue(new WalletNotFoundError('Wallet not found'))

      await expect(
        createSponsorshipRequest({ walletAddress: '0xnonexistent' })
      ).rejects.toThrow('Wallet not found')
    })

    it('throws BlockedWalletError when wallet is blocked', async () => {
      const { BlockedWalletError } = await import('../src/lib/errors.js')
      validateWalletExists.mockResolvedValue({ ...mockWallet, isBlocked: true })
      validateWalletNotBlocked.mockImplementation(() => {
        throw new BlockedWalletError('Wallet is blocked')
      })

      await expect(
        createSponsorshipRequest({ walletAddress: '0xabc123' })
      ).rejects.toThrow('Wallet is blocked')
    })

    it('throws ValidationError when wallet has pending request', async () => {
      const { ValidationError } = await import('../src/lib/errors.js')
      validateWalletExists.mockResolvedValue(mockWallet)
      validateWalletNotBlocked.mockReturnValue(undefined)
      validateNoPendingRequest.mockRejectedValue(
        new ValidationError('Wallet already has a pending sponsorship request')
      )

      await expect(
        createSponsorshipRequest({ walletAddress: '0xabc123' })
      ).rejects.toThrow('Wallet already has a pending sponsorship request')
    })
  })

  describe('getSponsorshipRequest', () => {
    it('returns sponsorship request with wallet info and relay transactions when found', async () => {
      const mockRequest = {
        id: 'req-uuid-1',
        walletId: 'wallet-uuid-1',
        status: 'pending',
        wallet: { id: 'wallet-uuid-1', walletAddress: '0xabc123' },
        relayTransactions: [],
      }
      prisma.sponsorshipRequest.findUnique.mockResolvedValue(mockRequest)

      const result = await getSponsorshipRequest('req-uuid-1')

      expect(prisma.sponsorshipRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'req-uuid-1' },
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
      expect(result).toEqual(mockRequest)
    })

    it('throws SponsorshipNotFoundError when request does not exist', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue(null)

      await expect(getSponsorshipRequest('nonexistent-id')).rejects.toThrow(
        'Sponsorship request not found'
      )
      await expect(getSponsorshipRequest('nonexistent-id')).rejects.toMatchObject({
        name: 'SponsorshipNotFoundError',
      })
    })
  })
})
