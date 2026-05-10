import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRelayTransaction, updateRelayStatus, getRelayTransactions } from '../src/services/relay.service.js'

vi.mock('@arcpass/shared', () => ({
  prisma: {
    relayTransaction: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@arcpass/shared'

describe('relay.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createRelayTransaction', () => {
    const sponsorshipRequestId = 'sr-uuid-1'

    it('creates a relay transaction with attempt 1 when no prior attempts exist', async () => {
      prisma.relayTransaction.findFirst.mockResolvedValue(null)
      const mockCreated = {
        id: 'rt-uuid-1',
        sponsorshipRequestId,
        status: 'queued',
        relayAttempt: 1,
        transactionHash: null,
        submittedAt: null,
        confirmedAt: null,
        failedAt: null,
        failureReason: null,
      }
      prisma.relayTransaction.create.mockResolvedValue(mockCreated)

      const result = await createRelayTransaction(sponsorshipRequestId)

      expect(prisma.relayTransaction.findFirst).toHaveBeenCalledWith({
        where: { sponsorshipRequestId },
        orderBy: { relayAttempt: 'desc' },
        select: { relayAttempt: true },
      })
      expect(prisma.relayTransaction.create).toHaveBeenCalledWith({
        data: {
          sponsorshipRequestId,
          status: 'queued',
          relayAttempt: 1,
        },
      })
      expect(result).toEqual(mockCreated)
    })

    it('increments relay attempt number based on previous attempts', async () => {
      prisma.relayTransaction.findFirst.mockResolvedValue({ relayAttempt: 3 })
      const mockCreated = {
        id: 'rt-uuid-2',
        sponsorshipRequestId,
        status: 'queued',
        relayAttempt: 4,
      }
      prisma.relayTransaction.create.mockResolvedValue(mockCreated)

      const result = await createRelayTransaction(sponsorshipRequestId)

      expect(prisma.relayTransaction.create).toHaveBeenCalledWith({
        data: {
          sponsorshipRequestId,
          status: 'queued',
          relayAttempt: 4,
        },
      })
      expect(result.relayAttempt).toBe(4)
    })

    it('always creates with status queued', async () => {
      prisma.relayTransaction.findFirst.mockResolvedValue(null)
      prisma.relayTransaction.create.mockResolvedValue({ id: 'rt-uuid-3', status: 'queued' })

      await createRelayTransaction(sponsorshipRequestId)

      expect(prisma.relayTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'queued' }),
        })
      )
    })
  })

  describe('updateRelayStatus', () => {
    const relayTransactionId = 'rt-uuid-1'

    it('updates status to submitted and sets submittedAt timestamp', async () => {
      const mockUpdated = {
        id: relayTransactionId,
        status: 'submitted',
        submittedAt: new Date(),
      }
      prisma.relayTransaction.update.mockResolvedValue(mockUpdated)

      const result = await updateRelayStatus(relayTransactionId, { status: 'submitted' })

      expect(prisma.relayTransaction.update).toHaveBeenCalledWith({
        where: { id: relayTransactionId },
        data: expect.objectContaining({
          status: 'submitted',
          submittedAt: expect.any(Date),
        }),
      })
      expect(result).toEqual(mockUpdated)
    })

    it('updates status to confirmed and sets confirmedAt timestamp', async () => {
      const mockUpdated = {
        id: relayTransactionId,
        status: 'confirmed',
        confirmedAt: new Date(),
      }
      prisma.relayTransaction.update.mockResolvedValue(mockUpdated)

      await updateRelayStatus(relayTransactionId, { status: 'confirmed' })

      expect(prisma.relayTransaction.update).toHaveBeenCalledWith({
        where: { id: relayTransactionId },
        data: expect.objectContaining({
          status: 'confirmed',
          confirmedAt: expect.any(Date),
        }),
      })
    })

    it('updates status to failed and sets failedAt timestamp and failureReason', async () => {
      const mockUpdated = {
        id: relayTransactionId,
        status: 'failed',
        failedAt: new Date(),
        failureReason: 'Gas estimation failed',
      }
      prisma.relayTransaction.update.mockResolvedValue(mockUpdated)

      await updateRelayStatus(relayTransactionId, {
        status: 'failed',
        failureReason: 'Gas estimation failed',
      })

      expect(prisma.relayTransaction.update).toHaveBeenCalledWith({
        where: { id: relayTransactionId },
        data: expect.objectContaining({
          status: 'failed',
          failedAt: expect.any(Date),
          failureReason: 'Gas estimation failed',
        }),
      })
    })

    it('sets transactionHash when provided', async () => {
      const txHash = '0xabc123def456'
      prisma.relayTransaction.update.mockResolvedValue({
        id: relayTransactionId,
        status: 'submitted',
        transactionHash: txHash,
      })

      await updateRelayStatus(relayTransactionId, {
        status: 'submitted',
        transactionHash: txHash,
      })

      expect(prisma.relayTransaction.update).toHaveBeenCalledWith({
        where: { id: relayTransactionId },
        data: expect.objectContaining({
          status: 'submitted',
          transactionHash: txHash,
        }),
      })
    })

    it('does not set timestamp fields for queued status', async () => {
      prisma.relayTransaction.update.mockResolvedValue({
        id: relayTransactionId,
        status: 'queued',
      })

      await updateRelayStatus(relayTransactionId, { status: 'queued' })

      const callData = prisma.relayTransaction.update.mock.calls[0][0].data
      expect(callData.submittedAt).toBeUndefined()
      expect(callData.confirmedAt).toBeUndefined()
      expect(callData.failedAt).toBeUndefined()
    })

    it('does not include transactionHash or failureReason when not provided', async () => {
      prisma.relayTransaction.update.mockResolvedValue({
        id: relayTransactionId,
        status: 'submitted',
      })

      await updateRelayStatus(relayTransactionId, { status: 'submitted' })

      const callData = prisma.relayTransaction.update.mock.calls[0][0].data
      expect(callData.transactionHash).toBeUndefined()
      expect(callData.failureReason).toBeUndefined()
    })
  })

  describe('getRelayTransactions', () => {
    const sponsorshipRequestId = 'sr-uuid-1'

    it('returns relay transactions ordered by relayAttempt ascending', async () => {
      const mockTransactions = [
        { id: 'rt-1', relayAttempt: 1, status: 'failed' },
        { id: 'rt-2', relayAttempt: 2, status: 'submitted' },
      ]
      prisma.relayTransaction.findMany.mockResolvedValue(mockTransactions)

      const result = await getRelayTransactions(sponsorshipRequestId)

      expect(prisma.relayTransaction.findMany).toHaveBeenCalledWith({
        where: { sponsorshipRequestId },
        orderBy: { relayAttempt: 'asc' },
      })
      expect(result).toEqual(mockTransactions)
    })

    it('returns empty array when no relay transactions exist', async () => {
      prisma.relayTransaction.findMany.mockResolvedValue([])

      const result = await getRelayTransactions(sponsorshipRequestId)

      expect(result).toEqual([])
    })
  })
})
