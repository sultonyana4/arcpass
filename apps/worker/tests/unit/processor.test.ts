import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WorkerConfig } from '../../src/config.js'

// Mock @arcpass/shared prisma
const mockQueryRaw = vi.fn()
const mockTransaction = vi.fn()
const mockPrisma = {
  $queryRaw: mockQueryRaw,
  $transaction: mockTransaction,
}

vi.mock('@arcpass/shared', () => ({
  prisma: {
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
    $transaction: (...args: any[]) => mockTransaction(...args),
  },
}))

// Mock lifecycle functions
const mockTransitionSponsorshipStatus = vi.fn()
const mockCreateRelayTransaction = vi.fn()
const mockUpdateRelayTransaction = vi.fn()
const mockGetRetryCount = vi.fn()

vi.mock('../../src/lifecycle.js', () => ({
  transitionSponsorshipStatus: (...args: any[]) => mockTransitionSponsorshipStatus(...args),
  createRelayTransaction: (...args: any[]) => mockCreateRelayTransaction(...args),
  updateRelayTransaction: (...args: any[]) => mockUpdateRelayTransaction(...args),
  getRetryCount: (...args: any[]) => mockGetRetryCount(...args),
}))

// Mock relay-executor
const mockExecuteRelay = vi.fn()

vi.mock('../../src/relay-executor.js', () => ({
  executeRelay: (...args: any[]) => mockExecuteRelay(...args),
}))

// Mock logger
vi.mock('../../src/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Import after mocks
const { processRequest, isAlreadySponsoredError } = await import('../../src/processor.js')

// Helper to create a minimal WorkerConfig
function createConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    databaseUrl: 'postgresql://localhost:5432/test',
    chainRpcUrl: 'https://rpc.example.com',
    sponsorPrivateKey: 'a'.repeat(64),
    pollIntervalMs: 5000,
    batchSize: 20,
    maxRetries: 5,
    lockTimeoutMs: 30000,
    shutdownTimeoutMs: 10000,
    confirmationBlocks: 2,
    txTimeoutMs: 120000,
    chainId: 1337,
    contractAddressSponsorVault: `0x${'a'.repeat(40)}` as `0x${string}`,
    contractAddressSponsorshipRegistry: `0x${'b'.repeat(40)}` as `0x${string}`,
    sponsorshipAmount: 1000000000000000n,
    chainIdVerifyTimeoutMs: 10000,
    explorerBaseUrl: 'https://testnet.arcscan.io/tx/',
    ...overrides,
  }
}

// Helper to set up the mock transaction to execute the callback
function setupTransaction() {
  mockTransaction.mockImplementation(async (callback: any, _options?: any) => {
    // Create a mock tx object that proxies to our mocked functions
    const tx = {
      $queryRaw: mockQueryRaw,
      wallet: { findUnique: vi.fn(), update: vi.fn() },
      relayTransaction: { findFirst: vi.fn() },
      sponsorshipRequest: { update: vi.fn() },
    }
    return callback(tx)
  })
}

describe('processRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTransaction()
  })

  describe('max retries enforcement (>= comparison)', () => {
    it('transitions to failed when retryCount equals MAX_RETRIES', async () => {
      const config = createConfig({ maxRetries: 5 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-1', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0x1234', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(5) // equals MAX_RETRIES
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })

        return callback(tx)
      })

      const result = await processRequest('req-1', config)

      expect(result.finalStatus).toBe('failed')
      expect(result.success).toBe(true)
      expect(mockTransitionSponsorshipStatus).toHaveBeenCalledWith(
        expect.anything(),
        'req-1',
        'failed'
      )
      // No new relay transaction should be created
      expect(mockCreateRelayTransaction).not.toHaveBeenCalled()
    })

    it('transitions to failed when retryCount exceeds MAX_RETRIES', async () => {
      const config = createConfig({ maxRetries: 3 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-2', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0xabcd', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(7) // exceeds MAX_RETRIES of 3
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })

        return callback(tx)
      })

      const result = await processRequest('req-2', config)

      expect(result.finalStatus).toBe('failed')
      expect(result.success).toBe(true)
      expect(mockTransitionSponsorshipStatus).toHaveBeenCalledWith(
        expect.anything(),
        'req-2',
        'failed'
      )
      expect(mockCreateRelayTransaction).not.toHaveBeenCalled()
    })

    it('does NOT transition to failed when retryCount is below MAX_RETRIES', async () => {
      const config = createConfig({ maxRetries: 5 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-3', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0x5678', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(4) // below MAX_RETRIES of 5
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })
        mockCreateRelayTransaction.mockResolvedValue({ id: 'relay-1', relayAttempt: 5 })
        mockUpdateRelayTransaction.mockResolvedValue({ success: true })
        mockExecuteRelay.mockResolvedValue({
          success: true,
          transactionHash: '0xhash',
          failureReason: null,
          blockNumber: 100n,
        })

        return callback(tx)
      })

      const result = await processRequest('req-3', config)

      // Should have created a new relay transaction
      expect(mockCreateRelayTransaction).toHaveBeenCalled()
      expect(result.finalStatus).not.toBe('failed')
    })

    it('uses >= comparison (boundary: retryCount === maxRetries - 1 allows retry)', async () => {
      const config = createConfig({ maxRetries: 3 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-4', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0x9999', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(2) // maxRetries - 1 = 2, should allow retry
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })
        mockCreateRelayTransaction.mockResolvedValue({ id: 'relay-2', relayAttempt: 3 })
        mockUpdateRelayTransaction.mockResolvedValue({ success: true })
        mockExecuteRelay.mockResolvedValue({
          success: true,
          transactionHash: '0xhash2',
          failureReason: null,
          blockNumber: 200n,
        })

        return callback(tx)
      })

      const result = await processRequest('req-4', config)

      // Should allow retry since retryCount (2) < maxRetries (3)
      expect(mockCreateRelayTransaction).toHaveBeenCalled()
      expect(result.finalStatus).not.toBe('failed')
    })
  })

  describe('stale execution recovery (relayed status)', () => {
    it('creates new relay transaction with correct relayAttempt for stale execution', async () => {
      const config = createConfig({ maxRetries: 5 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-stale', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0xstale', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(2) // 2 previous attempts, below MAX_RETRIES
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })
        mockCreateRelayTransaction.mockResolvedValue({ id: 'relay-new', relayAttempt: 3 })
        mockUpdateRelayTransaction.mockResolvedValue({ success: true })
        mockExecuteRelay.mockResolvedValue({
          success: true,
          transactionHash: '0xhash_stale',
          failureReason: null,
          blockNumber: 300n,
        })

        return callback(tx)
      })

      const result = await processRequest('req-stale', config)

      // Should create a new relay transaction (stale recovery)
      expect(mockCreateRelayTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'req-stale'
      )
      expect(result.success).toBe(true)
      expect(result.finalStatus).toBe('completed')
    })

    it('does not transition through pending→approved→relayed for stale executions', async () => {
      const config = createConfig({ maxRetries: 5 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-stale-2', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0xstale2', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(1)
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })
        mockCreateRelayTransaction.mockResolvedValue({ id: 'relay-stale-2', relayAttempt: 2 })
        mockUpdateRelayTransaction.mockResolvedValue({ success: true })
        mockExecuteRelay.mockResolvedValue({
          success: false,
          transactionHash: null,
          failureReason: 'RPC error',
        })

        return callback(tx)
      })

      await processRequest('req-stale-2', config)

      // For stale relayed requests, transitionSponsorshipStatus should NOT be called
      // with 'approved' (no pending→approved transition)
      const transitionCalls = mockTransitionSponsorshipStatus.mock.calls
      const approvedCalls = transitionCalls.filter(
        (call: any[]) => call[2] === 'approved'
      )
      expect(approvedCalls).toHaveLength(0)
    })

    it('transitions stale execution to failed when retries exhausted', async () => {
      const config = createConfig({ maxRetries: 3 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-stale-fail', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0xfail', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(3) // equals MAX_RETRIES
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })

        return callback(tx)
      })

      const result = await processRequest('req-stale-fail', config)

      expect(result.finalStatus).toBe('failed')
      expect(result.success).toBe(true)
      expect(mockTransitionSponsorshipStatus).toHaveBeenCalledWith(
        expect.anything(),
        'req-stale-fail',
        'failed'
      )
      expect(mockCreateRelayTransaction).not.toHaveBeenCalled()
    })
  })

  describe('no new relay transaction when at limit', () => {
    it('does not call createRelayTransaction when retryCount >= maxRetries', async () => {
      const config = createConfig({ maxRetries: 2 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-limit', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0xlimit', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(2) // equals MAX_RETRIES of 2
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })

        return callback(tx)
      })

      await processRequest('req-limit', config)

      expect(mockCreateRelayTransaction).not.toHaveBeenCalled()
      expect(mockExecuteRelay).not.toHaveBeenCalled()
    })

    it('does not call executeRelay when retryCount >= maxRetries', async () => {
      const config = createConfig({ maxRetries: 1 })

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'req-no-exec', status: 'relayed', walletId: 'wallet-1' },
          ]),
          wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'wallet-1', walletAddress: '0xnoexec', isBlocked: false }), update: vi.fn() },
          relayTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
          sponsorshipRequest: { update: vi.fn() },
        }

        mockGetRetryCount.mockResolvedValue(5) // well above MAX_RETRIES of 1
        mockTransitionSponsorshipStatus.mockResolvedValue({ success: true })

        return callback(tx)
      })

      await processRequest('req-no-exec', config)

      expect(mockExecuteRelay).not.toHaveBeenCalled()
    })
  })

  describe('isAlreadySponsoredError', () => {
    it('returns true for AlreadySponsored prefix', () => {
      expect(isAlreadySponsoredError('AlreadySponsored: wallet 0x123')).toBe(true)
    })

    it('returns true for exact AlreadySponsored string', () => {
      expect(isAlreadySponsoredError('AlreadySponsored')).toBe(true)
    })

    it('returns false for null', () => {
      expect(isAlreadySponsoredError(null)).toBe(false)
    })

    it('returns false for unrelated error', () => {
      expect(isAlreadySponsoredError('RPC timeout')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isAlreadySponsoredError('')).toBe(false)
    })
  })
})
