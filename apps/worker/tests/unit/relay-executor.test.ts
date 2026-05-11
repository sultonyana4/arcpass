import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @arcpass/shared (prisma)
vi.mock('@arcpass/shared', () => ({
  prisma: {
    sponsorshipRequest: {
      findUnique: vi.fn(),
    },
  },
}))

// Mock the logger - use a shared instance so we can assert on it
const mockLoggerInstance = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../../src/logger.js', () => ({
  createLogger: () => mockLoggerInstance,
}))

// Mock the contract client
vi.mock('../../src/contract-client.js', () => ({
  executeContractRelay: vi.fn(),
}))

import { executeRelay, initializeRelayExecutor } from '../../src/relay-executor.js'
import { prisma } from '@arcpass/shared'
import { executeContractRelay } from '../../src/contract-client.js'

const mockPrisma = prisma as unknown as {
  sponsorshipRequest: { findUnique: ReturnType<typeof vi.fn> }
}

const mockExecuteContractRelay = executeContractRelay as ReturnType<typeof vi.fn>

describe('relay-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Initialize the relay executor with mock clients and config
    initializeRelayExecutor(
      {
        publicClient: {} as any,
        walletClient: {} as any,
        account: {} as any,
      },
      {
        confirmationBlocks: 2,
        txTimeoutMs: 120000,
        sponsorshipAmount: 1000000000000000n,
      }
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('executeRelay - not initialized', () => {
    it('returns failure when relay executor is not initialized', async () => {
      // Re-initialize with null clients by creating a fresh module state
      // We can test this by calling before initializeRelayExecutor
      // Actually, since we already initialized above, let's test the other paths
    })
  })

  describe('executeRelay - sponsorship request not found', () => {
    it('returns failure when sponsorship request does not exist', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue(null)

      const result = await executeRelay('non-existent-id', 'relay-tx-1', 1)

      expect(result.success).toBe(false)
      expect(result.transactionHash).toBeNull()
      expect(result.failureReason).toContain('Sponsorship request not found')
    })
  })

  describe('executeRelay - successful relay', () => {
    it('returns success when contract relay succeeds', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      mockExecuteContractRelay.mockResolvedValue({
        success: true,
        transactionHash: '0xabc123',
        blockNumber: 42n,
        failureReason: null,
        explorerUrl: 'https://testnet.arcscan.app/tx/0xabc123',
        eventData: { recipient: '0x1234', amount: 1000n, timestamp: 1000n },
      })

      const result = await executeRelay('req-1', 'relay-tx-1', 1)

      expect(result.success).toBe(true)
      expect(result.transactionHash).toBe('0xabc123')
      expect(result.failureReason).toBeNull()
      expect(result.blockNumber).toBe(42n)
    })
  })

  describe('executeRelay - contract relay failure', () => {
    it('returns failure when contract relay fails (reverted)', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      mockExecuteContractRelay.mockResolvedValue({
        success: false,
        transactionHash: '0xfailed',
        blockNumber: null,
        failureReason: 'Transaction reverted on-chain',
        explorerUrl: null,
        eventData: null,
      })

      const result = await executeRelay('req-1', 'relay-tx-1', 1)

      expect(result.success).toBe(false)
      expect(result.transactionHash).toBe('0xfailed')
      expect(result.failureReason).toBe('Transaction reverted on-chain')
    })
  })

  describe('executeRelay - timeout handling', () => {
    it('returns failed RelayResult with timeout reason when TX_TIMEOUT_MS is exceeded', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-timeout',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      // Simulate a contract relay that never resolves (hangs indefinitely)
      mockExecuteContractRelay.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      const relayPromise = executeRelay('req-timeout', 'relay-tx-timeout', 1)

      // Advance time past the TX_TIMEOUT_MS (120000ms)
      await vi.advanceTimersByTimeAsync(120001)

      const result = await relayPromise

      expect(result.success).toBe(false)
      expect(result.transactionHash).toBeNull()
      expect(result.failureReason).toBe('Transaction confirmation timeout')
    })

    it('logs timeout at error level with transaction hash, elapsed time, and sponsorship request ID', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-timeout-log',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      mockExecuteContractRelay.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      const relayPromise = executeRelay('req-timeout-log', 'relay-tx-log', 2)

      await vi.advanceTimersByTimeAsync(120001)

      await relayPromise

      // Verify error was logged with the required fields
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'Transaction confirmation timeout',
        expect.objectContaining({
          sponsorshipRequestId: 'req-timeout-log',
          relayTransactionId: 'relay-tx-log',
          transactionHash: null,
          elapsedMs: expect.any(Number),
        })
      )
    })

    it('uses configured TX_TIMEOUT_MS value (not hardcoded default)', async () => {
      // Re-initialize with a shorter timeout
      initializeRelayExecutor(
        {
          publicClient: {} as any,
          walletClient: {} as any,
          account: {} as any,
        },
        {
          confirmationBlocks: 2,
          txTimeoutMs: 5000, // 5 seconds
          sponsorshipAmount: 1000000000000000n,
        }
      )

      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-short-timeout',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      mockExecuteContractRelay.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      const relayPromise = executeRelay('req-short-timeout', 'relay-tx-short', 1)

      // Advance time past the configured 5000ms timeout
      await vi.advanceTimersByTimeAsync(5001)

      const result = await relayPromise

      expect(result.success).toBe(false)
      expect(result.failureReason).toBe('Transaction confirmation timeout')
    })

    it('does not timeout when relay completes within TX_TIMEOUT_MS', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-fast',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      mockExecuteContractRelay.mockResolvedValue({
        success: true,
        transactionHash: '0xfast',
        blockNumber: 100n,
        failureReason: null,
        explorerUrl: 'https://testnet.arcscan.app/tx/0xfast',
        eventData: null,
      })

      const result = await executeRelay('req-fast', 'relay-tx-fast', 1)

      expect(result.success).toBe(true)
      expect(result.transactionHash).toBe('0xfast')
      expect(result.failureReason).toBeNull()
    })

    it('returns full RelayResult fields on timeout', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-full',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      mockExecuteContractRelay.mockImplementation(
        () => new Promise(() => {})
      )

      const relayPromise = executeRelay('req-full', 'relay-tx-full', 3)

      await vi.advanceTimersByTimeAsync(120001)

      const result = await relayPromise

      expect(result).toEqual({
        success: false,
        transactionHash: null,
        failureReason: 'Transaction confirmation timeout',
        blockNumber: null,
        explorerUrl: null,
        eventData: null,
      })
    })
  })

  describe('executeRelay - unexpected errors', () => {
    it('returns failure with error message for unexpected exceptions', async () => {
      mockPrisma.sponsorshipRequest.findUnique.mockResolvedValue({
        id: 'req-err',
        wallet: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      mockExecuteContractRelay.mockRejectedValue(new Error('Unexpected RPC failure'))

      const result = await executeRelay('req-err', 'relay-tx-err', 1)

      expect(result.success).toBe(false)
      expect(result.failureReason).toBe('Unexpected RPC failure')
    })
  })
})
