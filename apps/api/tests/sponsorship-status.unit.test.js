import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateSponsorshipStatus } from '../src/services/sponsorship.service.js'

vi.mock('@arcpass/shared', () => ({
  prisma: {
    sponsorshipRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../src/lib/sponsorship-validation.js', () => ({
  validateWalletExists: vi.fn(),
  validateWalletNotBlocked: vi.fn(),
  validateNoPendingRequest: vi.fn(),
}))

import { prisma } from '@arcpass/shared'

describe('updateSponsorshipStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('valid transitions', () => {
    it('transitions from pending to approved', async () => {
      const mockRequest = { id: 'req-1', status: 'pending' }
      const mockUpdated = { id: 'req-1', status: 'approved', approvedAt: expect.any(Date) }

      prisma.sponsorshipRequest.findUnique.mockResolvedValue(mockRequest)
      prisma.sponsorshipRequest.update.mockResolvedValue(mockUpdated)

      const result = await updateSponsorshipStatus('req-1', 'approved')

      expect(prisma.sponsorshipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'approved', approvedAt: expect.any(Date) },
      })
      expect(result).toEqual(mockUpdated)
    })

    it('transitions from pending to rejected', async () => {
      const mockRequest = { id: 'req-1', status: 'pending' }
      const mockUpdated = { id: 'req-1', status: 'rejected', rejectedAt: expect.any(Date) }

      prisma.sponsorshipRequest.findUnique.mockResolvedValue(mockRequest)
      prisma.sponsorshipRequest.update.mockResolvedValue(mockUpdated)

      const result = await updateSponsorshipStatus('req-1', 'rejected')

      expect(prisma.sponsorshipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'rejected', rejectedAt: expect.any(Date) },
      })
      expect(result).toEqual(mockUpdated)
    })

    it('transitions from approved to relayed', async () => {
      const mockRequest = { id: 'req-1', status: 'approved' }
      const mockUpdated = { id: 'req-1', status: 'relayed' }

      prisma.sponsorshipRequest.findUnique.mockResolvedValue(mockRequest)
      prisma.sponsorshipRequest.update.mockResolvedValue(mockUpdated)

      const result = await updateSponsorshipStatus('req-1', 'relayed')

      expect(prisma.sponsorshipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'relayed' },
      })
      expect(result).toEqual(mockUpdated)
    })

    it('transitions from relayed to completed', async () => {
      const mockRequest = { id: 'req-1', status: 'relayed' }
      const mockUpdated = { id: 'req-1', status: 'completed', completedAt: expect.any(Date) }

      prisma.sponsorshipRequest.findUnique.mockResolvedValue(mockRequest)
      prisma.sponsorshipRequest.update.mockResolvedValue(mockUpdated)

      const result = await updateSponsorshipStatus('req-1', 'completed')

      expect(prisma.sponsorshipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'completed', completedAt: expect.any(Date) },
      })
      expect(result).toEqual(mockUpdated)
    })

    it('transitions from relayed to failed', async () => {
      const mockRequest = { id: 'req-1', status: 'relayed' }
      const mockUpdated = { id: 'req-1', status: 'failed', failedAt: expect.any(Date) }

      prisma.sponsorshipRequest.findUnique.mockResolvedValue(mockRequest)
      prisma.sponsorshipRequest.update.mockResolvedValue(mockUpdated)

      const result = await updateSponsorshipStatus('req-1', 'failed')

      expect(prisma.sponsorshipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'failed', failedAt: expect.any(Date) },
      })
      expect(result).toEqual(mockUpdated)
    })
  })

  describe('invalid transitions', () => {
    it('rejects transition from completed to pending', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'completed' })

      await expect(updateSponsorshipStatus('req-1', 'pending')).rejects.toMatchObject({
        name: 'InvalidStatusTransitionError',
        message: "Cannot transition from 'completed' to 'pending'",
      })
    })

    it('rejects transition from rejected to approved', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'rejected' })

      await expect(updateSponsorshipStatus('req-1', 'approved')).rejects.toMatchObject({
        name: 'InvalidStatusTransitionError',
        message: "Cannot transition from 'rejected' to 'approved'",
      })
    })

    it('rejects transition from failed to completed', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'failed' })

      await expect(updateSponsorshipStatus('req-1', 'completed')).rejects.toMatchObject({
        name: 'InvalidStatusTransitionError',
        message: "Cannot transition from 'failed' to 'completed'",
      })
    })

    it('rejects transition from pending to completed (skipping steps)', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'pending' })

      await expect(updateSponsorshipStatus('req-1', 'completed')).rejects.toMatchObject({
        name: 'InvalidStatusTransitionError',
        message: "Cannot transition from 'pending' to 'completed'",
      })
    })

    it('rejects transition from approved to rejected', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'approved' })

      await expect(updateSponsorshipStatus('req-1', 'rejected')).rejects.toMatchObject({
        name: 'InvalidStatusTransitionError',
        message: "Cannot transition from 'approved' to 'rejected'",
      })
    })
  })

  describe('error handling', () => {
    it('throws SponsorshipNotFoundError when request does not exist', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue(null)

      await expect(updateSponsorshipStatus('nonexistent-id', 'approved')).rejects.toMatchObject({
        name: 'SponsorshipNotFoundError',
        message: 'Sponsorship request not found',
      })
    })
  })

  describe('timestamp handling', () => {
    it('does not set a timestamp for relayed status', async () => {
      prisma.sponsorshipRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'approved' })
      prisma.sponsorshipRequest.update.mockResolvedValue({ id: 'req-1', status: 'relayed' })

      await updateSponsorshipStatus('req-1', 'relayed')

      const updateCall = prisma.sponsorshipRequest.update.mock.calls[0][0]
      expect(updateCall.data).toEqual({ status: 'relayed' })
      expect(updateCall.data.approvedAt).toBeUndefined()
      expect(updateCall.data.rejectedAt).toBeUndefined()
      expect(updateCall.data.completedAt).toBeUndefined()
      expect(updateCall.data.failedAt).toBeUndefined()
    })
  })
})
