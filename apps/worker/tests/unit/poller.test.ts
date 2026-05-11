import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WorkerConfig } from '../../src/config.js'

// Mock @arcpass/shared (prisma)
const mockQueryRaw = vi.fn()
vi.mock('@arcpass/shared', () => ({
  prisma: {
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
  },
}))

// Mock processor
const mockProcessRequest = vi.fn()
vi.mock('../../src/processor.js', () => ({
  processRequest: (...args: any[]) => mockProcessRequest(...args),
}))

// Mock logger
const mockLoggerInfo = vi.fn()
const mockLoggerError = vi.fn()
const mockLoggerWarn = vi.fn()
vi.mock('../../src/logger.js', () => ({
  createLogger: () => ({
    info: (...args: any[]) => mockLoggerInfo(...args),
    warn: (...args: any[]) => mockLoggerWarn(...args),
    error: (...args: any[]) => mockLoggerError(...args),
  }),
}))

// Import after mocks
import { createPoller } from '../../src/poller.js'

function createTestConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    databaseUrl: 'postgresql://localhost:5432/test',
    chainRpcUrl: 'https://rpc.example.com',
    sponsorPrivateKey: 'a'.repeat(64),
    pollIntervalMs: 100,
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
  } as WorkerConfig
}

describe('Poller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockQueryRaw.mockReset()
    mockProcessRequest.mockReset()
    mockLoggerInfo.mockReset()
    mockLoggerError.mockReset()
    mockLoggerWarn.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('error recovery - database connection errors (Req 9.1)', () => {
    it('catches database connection errors, logs them, and schedules next cycle', async () => {
      const config = createTestConfig({ pollIntervalMs: 200 })
      const dbError = new Error('Connection refused: ECONNREFUSED')
      mockQueryRaw.mockRejectedValueOnce(dbError)

      const poller = createPoller(config)
      poller.start()

      // Wait for the first poll cycle to complete
      await vi.advanceTimersByTimeAsync(0)

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error during poll cycle',
        expect.objectContaining({ error: 'Connection refused: ECONNREFUSED' })
      )

      // Verify next cycle is scheduled (not crashed)
      // Set up a successful response for the next cycle
      mockQueryRaw.mockResolvedValueOnce([])
      await vi.advanceTimersByTimeAsync(200)

      // The second poll cycle should have executed (query called again)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })

    it('catches query timeout errors and schedules next cycle', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })
      const timeoutError = new Error('Query timeout: canceling statement due to statement timeout')
      mockQueryRaw.mockRejectedValueOnce(timeoutError)

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error during poll cycle',
        expect.objectContaining({ error: expect.stringContaining('timeout') })
      )

      // Next cycle should be scheduled
      mockQueryRaw.mockResolvedValueOnce([])
      await vi.advanceTimersByTimeAsync(100)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })
  })

  describe('error recovery - unhandled exceptions from request processing (Req 9.6)', () => {
    it('catches unhandled exceptions from processRequest and continues with next item', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      // Return 3 pending requests
      mockQueryRaw.mockResolvedValueOnce([
        { id: 'req-1' },
        { id: 'req-2' },
        { id: 'req-3' },
      ])

      // First request throws, second succeeds, third succeeds
      mockProcessRequest
        .mockRejectedValueOnce(new Error('Unexpected crash in processor'))
        .mockResolvedValueOnce({ requestId: 'req-2', success: true, finalStatus: 'completed' })
        .mockResolvedValueOnce({ requestId: 'req-3', success: true, finalStatus: 'completed' })

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      // All 3 requests should have been attempted
      expect(mockProcessRequest).toHaveBeenCalledTimes(3)
      expect(mockProcessRequest).toHaveBeenCalledWith('req-1', config)
      expect(mockProcessRequest).toHaveBeenCalledWith('req-2', config)
      expect(mockProcessRequest).toHaveBeenCalledWith('req-3', config)

      // Error should be logged for the failed request
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unhandled exception processing request',
        expect.objectContaining({
          requestId: 'req-1',
          error: 'Unexpected crash in processor',
        })
      )

      // Next cycle should be scheduled
      mockQueryRaw.mockResolvedValueOnce([])
      await vi.advanceTimersByTimeAsync(100)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })

    it('does not crash the process when processRequest throws a non-Error', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      mockQueryRaw.mockResolvedValueOnce([{ id: 'req-1' }])
      mockProcessRequest.mockRejectedValueOnce('string error thrown')

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unhandled exception processing request',
        expect.objectContaining({
          requestId: 'req-1',
          error: 'string error thrown',
        })
      )

      // Next cycle scheduled
      mockQueryRaw.mockResolvedValueOnce([])
      await vi.advanceTimersByTimeAsync(100)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })

    it('logs failed process results without crashing', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      mockQueryRaw.mockResolvedValueOnce([{ id: 'req-1' }])
      mockProcessRequest.mockResolvedValueOnce({
        requestId: 'req-1',
        success: false,
        finalStatus: 'pending',
        error: 'Transaction failed',
      })

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Failed to process request',
        expect.objectContaining({
          requestId: 'req-1',
          error: 'Transaction failed',
        })
      )

      // Next cycle scheduled
      mockQueryRaw.mockResolvedValueOnce([])
      await vi.advanceTimersByTimeAsync(100)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })
  })

  describe('stale execution detection query (Req 9.4, 11.1)', () => {
    it('queries for both pending and stale relayed requests', async () => {
      const config = createTestConfig({ batchSize: 10 })

      mockQueryRaw.mockResolvedValueOnce([])

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      // Verify the query was called
      expect(mockQueryRaw).toHaveBeenCalledTimes(1)

      // The first argument to $queryRaw is a tagged template literal (TemplateStringsArray)
      // We verify the query structure by checking the template strings
      const callArgs = mockQueryRaw.mock.calls[0]
      const templateStrings = callArgs[0]

      // Join template strings to reconstruct the query
      const queryText = Array.isArray(templateStrings)
        ? templateStrings.join('?')
        : String(templateStrings)

      // Verify query includes pending status
      expect(queryText).toContain("sr.status = 'pending'")

      // Verify query includes stale relayed detection
      expect(queryText).toContain("sr.status = 'relayed'")
      expect(queryText).toContain('NOT EXISTS')
      expect(queryText).toContain("rt.status IN ('submitted', 'confirmed')")

      // Verify ordering
      expect(queryText).toContain('ORDER BY sr."requestedAt" ASC')

      // Verify LIMIT uses batchSize
      expect(queryText).toContain('LIMIT')

      await poller.stop()
    })

    it('uses configured batchSize as the LIMIT', async () => {
      const config = createTestConfig({ batchSize: 50 })

      mockQueryRaw.mockResolvedValueOnce([])

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      // The batchSize is passed as a parameter in the tagged template literal
      const callArgs = mockQueryRaw.mock.calls[0]
      // In Prisma's $queryRaw with tagged templates, parameters are the interpolated values
      // The batchSize (50) should be one of the parameters
      const params = callArgs.slice(1)
      expect(params).toContain(50)

      await poller.stop()
    })
  })

  describe('poll cycle scheduling', () => {
    it('schedules next cycle after configured pollIntervalMs', async () => {
      const config = createTestConfig({ pollIntervalMs: 500 })

      mockQueryRaw.mockResolvedValue([])

      const poller = createPoller(config)
      poller.start()

      // First cycle executes immediately
      await vi.advanceTimersByTimeAsync(0)
      expect(mockQueryRaw).toHaveBeenCalledTimes(1)

      // Not yet time for second cycle
      await vi.advanceTimersByTimeAsync(499)
      expect(mockQueryRaw).toHaveBeenCalledTimes(1)

      // Now the second cycle should fire
      await vi.advanceTimersByTimeAsync(1)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })

    it('does not overlap poll cycles (uses setTimeout, not setInterval)', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      // Make the first query take a while
      let resolveFirst: (value: any[]) => void
      const firstPromise = new Promise<any[]>((resolve) => {
        resolveFirst = resolve
      })
      mockQueryRaw.mockReturnValueOnce(firstPromise)

      const poller = createPoller(config)
      poller.start()

      // Advance past pollIntervalMs — second cycle should NOT start
      await vi.advanceTimersByTimeAsync(200)
      expect(mockQueryRaw).toHaveBeenCalledTimes(1)

      // Resolve the first query
      mockQueryRaw.mockResolvedValueOnce([])
      resolveFirst!([])
      await vi.advanceTimersByTimeAsync(0)

      // Now after pollIntervalMs, second cycle should start
      await vi.advanceTimersByTimeAsync(100)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })
  })

  describe('start and stop lifecycle', () => {
    it('does not poll when not started', async () => {
      const config = createTestConfig()
      const poller = createPoller(config)

      await vi.advanceTimersByTimeAsync(1000)
      expect(mockQueryRaw).not.toHaveBeenCalled()

      await poller.stop()
    })

    it('stops scheduling new cycles after stop() is called', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      mockQueryRaw.mockResolvedValue([])

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)
      expect(mockQueryRaw).toHaveBeenCalledTimes(1)

      await poller.stop()

      // Advance time — no more cycles should fire
      await vi.advanceTimersByTimeAsync(500)
      expect(mockQueryRaw).toHaveBeenCalledTimes(1)
    })

    it('stops processing remaining batch items when stop() is called mid-batch', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      mockQueryRaw.mockResolvedValueOnce([
        { id: 'req-1' },
        { id: 'req-2' },
        { id: 'req-3' },
      ])

      let stopPoller: (() => Promise<void>) | null = null

      mockProcessRequest.mockImplementation(async (id: string) => {
        if (id === 'req-1') {
          // Stop the poller after processing the first request
          if (stopPoller) await stopPoller()
        }
        return { requestId: id, success: true, finalStatus: 'completed' }
      })

      const poller = createPoller(config)
      stopPoller = () => poller.stop()
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      // Only the first request should have been processed (stop was called)
      expect(mockProcessRequest).toHaveBeenCalledTimes(1)
    })
  })

  describe('successful processing', () => {
    it('processes all requests in the batch sequentially', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      mockQueryRaw.mockResolvedValueOnce([
        { id: 'req-1' },
        { id: 'req-2' },
        { id: 'req-3' },
      ])

      const callOrder: string[] = []
      mockProcessRequest.mockImplementation(async (id: string) => {
        callOrder.push(id)
        return { requestId: id, success: true, finalStatus: 'completed' }
      })

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(callOrder).toEqual(['req-1', 'req-2', 'req-3'])

      await poller.stop()
    })

    it('handles empty batch gracefully', async () => {
      const config = createTestConfig({ pollIntervalMs: 100 })

      mockQueryRaw.mockResolvedValueOnce([])

      const poller = createPoller(config)
      poller.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(mockProcessRequest).not.toHaveBeenCalled()
      expect(mockLoggerError).not.toHaveBeenCalled()

      // Next cycle should still be scheduled
      mockQueryRaw.mockResolvedValueOnce([])
      await vi.advanceTimersByTimeAsync(100)
      expect(mockQueryRaw).toHaveBeenCalledTimes(2)

      await poller.stop()
    })
  })
})
