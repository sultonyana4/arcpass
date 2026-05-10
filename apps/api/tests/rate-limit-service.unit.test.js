import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock prisma
const mockFindFirst = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@arcpass/shared', () => ({
  prisma: {
    rateLimit: {
      findFirst: (...args) => mockFindFirst(...args),
      create: (...args) => mockCreate(...args),
      update: (...args) => mockUpdate(...args),
    },
  },
}))

describe('Rate Limit Service', () => {
  let checkIpRateLimit
  let incrementIpRequestCount
  let checkWalletRateLimit
  let incrementWalletRequestCount
  let blockIdentifier
  let RateLimitError

  beforeEach(async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    mockFindFirst.mockReset()
    mockCreate.mockReset()
    mockUpdate.mockReset()

    const mod = await import('../src/services/rate-limit.service.js')
    const errors = await import('../src/lib/errors.js')
    checkIpRateLimit = mod.checkIpRateLimit
    incrementIpRequestCount = mod.incrementIpRequestCount
    checkWalletRateLimit = mod.checkWalletRateLimit
    incrementWalletRequestCount = mod.incrementWalletRequestCount
    blockIdentifier = mod.blockIdentifier
    RateLimitError = errors.RateLimitError
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('checkIpRateLimit', () => {
    it('should allow request when no rate limit record exists', async () => {
      mockFindFirst.mockResolvedValue(null)

      await expect(checkIpRateLimit('192.168.1.1')).resolves.toBeUndefined()
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { identifier: '192.168.1.1', identifierType: 'ip' },
      })
    })

    it('should throw RateLimitError when IP is blocked until future time', async () => {
      const futureDate = new Date(Date.now() + 60_000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 15,
        windowStart: new Date(Date.now() - 30_000),
        blockedUntil: futureDate,
      })

      await expect(checkIpRateLimit('10.0.0.1')).rejects.toThrow(RateLimitError)
      await expect(checkIpRateLimit('10.0.0.1')).rejects.toThrow('Too many requests')
    })

    it('should include retryAfter when IP is blocked', async () => {
      const futureDate = new Date(Date.now() + 120_000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 15,
        windowStart: new Date(Date.now() - 30_000),
        blockedUntil: futureDate,
      })

      try {
        await checkIpRateLimit('10.0.0.1')
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError)
        expect(err.retryAfter).toBeGreaterThan(0)
        expect(err.retryAfter).toBeLessThanOrEqual(120)
      }
    })

    it('should allow request when blockedUntil is in the past', async () => {
      const pastDate = new Date(Date.now() - 60_000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 5,
        windowStart: new Date(Date.now() - 30_000),
        blockedUntil: pastDate,
      })

      await expect(checkIpRateLimit('10.0.0.1')).resolves.toBeUndefined()
    })

    it('should allow request when window has expired', async () => {
      // Window started 2 hours ago (default window is 1 hour)
      const windowStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 100,
        windowStart,
        blockedUntil: null,
      })

      await expect(checkIpRateLimit('10.0.0.1')).resolves.toBeUndefined()
    })

    it('should throw RateLimitError when request count exceeds limit within window', async () => {
      // Window started 30 minutes ago (still active)
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 10, // equals default max of 10
        windowStart,
        blockedUntil: null,
      })

      await expect(checkIpRateLimit('10.0.0.1')).rejects.toThrow(RateLimitError)
    })

    it('should allow request when count is below limit within window', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 9, // below default max of 10
        windowStart,
        blockedUntil: null,
      })

      await expect(checkIpRateLimit('10.0.0.1')).resolves.toBeUndefined()
    })

    it('should respect RATE_LIMIT_IP_MAX env var', async () => {
      vi.stubEnv('RATE_LIMIT_IP_MAX', '5')

      // Re-import to pick up env change
      vi.resetModules()
      const mod = await import('../src/services/rate-limit.service.js')
      const errors = await import('../src/lib/errors.js')

      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 5,
        windowStart,
        blockedUntil: null,
      })

      await expect(mod.checkIpRateLimit('10.0.0.1')).rejects.toThrow(errors.RateLimitError)
    })

    it('should respect RATE_LIMIT_WINDOW_MS env var', async () => {
      // Set window to 5 minutes
      vi.stubEnv('RATE_LIMIT_WINDOW_MS', '300000')

      vi.resetModules()
      const mod = await import('../src/services/rate-limit.service.js')

      // Window started 6 minutes ago — should be expired with 5min window
      const windowStart = new Date(Date.now() - 6 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 100,
        windowStart,
        blockedUntil: null,
      })

      await expect(mod.checkIpRateLimit('10.0.0.1')).resolves.toBeUndefined()
    })
  })

  describe('incrementIpRequestCount', () => {
    it('should create a new record when none exists', async () => {
      mockFindFirst.mockResolvedValue(null)
      const created = {
        id: 'new-1',
        identifier: '192.168.1.1',
        identifierType: 'ip',
        requestCount: 1,
        windowStart: new Date(),
      }
      mockCreate.mockResolvedValue(created)

      const result = await incrementIpRequestCount('192.168.1.1')

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: '192.168.1.1',
          identifierType: 'ip',
          requestCount: 1,
        }),
      })
      expect(result).toEqual(created)
    })

    it('should increment counter when window is still active', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 3,
        windowStart,
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 4 }
      mockUpdate.mockResolvedValue(updated)

      const result = await incrementIpRequestCount('10.0.0.1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { requestCount: 4 },
      })
      expect(result.requestCount).toBe(4)
    })

    it('should auto-block IP when count reaches the max', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 9, // one below default max of 10
        windowStart,
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 10, blockedUntil: expect.any(Date) }
      mockUpdate.mockResolvedValue(updated)

      await incrementIpRequestCount('10.0.0.1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: {
          requestCount: 10,
          blockedUntil: expect.any(Date),
        },
      })
    })

    it('should reset counter when window has expired', async () => {
      // Window started 2 hours ago (expired with default 1hr window)
      const windowStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 8,
        windowStart,
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 1, windowStart: new Date() }
      mockUpdate.mockResolvedValue(updated)

      const result = await incrementIpRequestCount('10.0.0.1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: expect.objectContaining({
          requestCount: 1,
          blockedUntil: null,
        }),
      })
      expect(result.requestCount).toBe(1)
    })

    it('should clear blockedUntil when resetting window', async () => {
      const windowStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 15,
        windowStart,
        blockedUntil: new Date(Date.now() - 30_000), // expired block
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 1, windowStart: new Date(), blockedUntil: null }
      mockUpdate.mockResolvedValue(updated)

      await incrementIpRequestCount('10.0.0.1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: expect.objectContaining({
          requestCount: 1,
          blockedUntil: null,
        }),
      })
    })
  })

  describe('checkWalletRateLimit', () => {
    it('should allow request when no rate limit record exists', async () => {
      mockFindFirst.mockResolvedValue(null)

      await expect(checkWalletRateLimit('0xabc123')).resolves.toBeUndefined()
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { identifier: '0xabc123', identifierType: 'wallet' },
      })
    })

    it('should throw RateLimitError when wallet is blocked until future time', async () => {
      const futureDate = new Date(Date.now() + 60_000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 10,
        windowStart: new Date(Date.now() - 30_000),
        blockedUntil: futureDate,
      })

      await expect(checkWalletRateLimit('0xabc123')).rejects.toThrow(RateLimitError)
      await expect(checkWalletRateLimit('0xabc123')).rejects.toThrow('Too many requests')
    })

    it('should include retryAfter when wallet is blocked', async () => {
      const futureDate = new Date(Date.now() + 120_000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 10,
        windowStart: new Date(Date.now() - 30_000),
        blockedUntil: futureDate,
      })

      try {
        await checkWalletRateLimit('0xabc123')
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError)
        expect(err.retryAfter).toBeGreaterThan(0)
        expect(err.retryAfter).toBeLessThanOrEqual(120)
      }
    })

    it('should allow request when blockedUntil is in the past', async () => {
      const pastDate = new Date(Date.now() - 60_000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 3,
        windowStart: new Date(Date.now() - 30_000),
        blockedUntil: pastDate,
      })

      await expect(checkWalletRateLimit('0xabc123')).resolves.toBeUndefined()
    })

    it('should allow request when window has expired', async () => {
      const windowStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 100,
        windowStart,
        blockedUntil: null,
      })

      await expect(checkWalletRateLimit('0xabc123')).resolves.toBeUndefined()
    })

    it('should throw RateLimitError when request count exceeds wallet limit within window', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 5, // equals default wallet max of 5
        windowStart,
        blockedUntil: null,
      })

      await expect(checkWalletRateLimit('0xabc123')).rejects.toThrow(RateLimitError)
    })

    it('should allow request when count is below wallet limit within window', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 4, // below default wallet max of 5
        windowStart,
        blockedUntil: null,
      })

      await expect(checkWalletRateLimit('0xabc123')).resolves.toBeUndefined()
    })

    it('should respect RATE_LIMIT_WALLET_MAX env var', async () => {
      vi.stubEnv('RATE_LIMIT_WALLET_MAX', '3')

      vi.resetModules()
      const mod = await import('../src/services/rate-limit.service.js')
      const errors = await import('../src/lib/errors.js')

      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 3,
        windowStart,
        blockedUntil: null,
      })

      await expect(mod.checkWalletRateLimit('0xabc123')).rejects.toThrow(errors.RateLimitError)
    })

    it('should respect RATE_LIMIT_WINDOW_MS env var for wallet checks', async () => {
      vi.stubEnv('RATE_LIMIT_WINDOW_MS', '300000') // 5 minutes

      vi.resetModules()
      const mod = await import('../src/services/rate-limit.service.js')

      // Window started 6 minutes ago — should be expired with 5min window
      const windowStart = new Date(Date.now() - 6 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 100,
        windowStart,
        blockedUntil: null,
      })

      await expect(mod.checkWalletRateLimit('0xabc123')).resolves.toBeUndefined()
    })
  })

  describe('incrementWalletRequestCount', () => {
    it('should create a new record when none exists', async () => {
      mockFindFirst.mockResolvedValue(null)
      const created = {
        id: 'new-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 1,
        windowStart: new Date(),
      }
      mockCreate.mockResolvedValue(created)

      const result = await incrementWalletRequestCount('0xabc123')

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: '0xabc123',
          identifierType: 'wallet',
          requestCount: 1,
        }),
      })
      expect(result).toEqual(created)
    })

    it('should increment counter when window is still active', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 3,
        windowStart,
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 4 }
      mockUpdate.mockResolvedValue(updated)

      const result = await incrementWalletRequestCount('0xabc123')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { requestCount: 4 },
      })
      expect(result.requestCount).toBe(4)
    })

    it('should auto-block wallet when count reaches the max', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 4, // one below default wallet max of 5
        windowStart,
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 5, blockedUntil: expect.any(Date) }
      mockUpdate.mockResolvedValue(updated)

      await incrementWalletRequestCount('0xabc123')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: {
          requestCount: 5,
          blockedUntil: expect.any(Date),
        },
      })
    })

    it('should reset counter when window has expired', async () => {
      const windowStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 5,
        windowStart,
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 1, windowStart: new Date() }
      mockUpdate.mockResolvedValue(updated)

      const result = await incrementWalletRequestCount('0xabc123')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: expect.objectContaining({
          requestCount: 1,
          blockedUntil: null,
        }),
      })
      expect(result.requestCount).toBe(1)
    })

    it('should clear blockedUntil when resetting window', async () => {
      const windowStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 10,
        windowStart,
        blockedUntil: new Date(Date.now() - 30_000),
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, requestCount: 1, windowStart: new Date(), blockedUntil: null }
      mockUpdate.mockResolvedValue(updated)

      await incrementWalletRequestCount('0xabc123')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: expect.objectContaining({
          requestCount: 1,
          blockedUntil: null,
        }),
      })
    })
  })

  describe('blockIdentifier', () => {
    it('should create a new record with blockedUntil when none exists', async () => {
      mockFindFirst.mockResolvedValue(null)
      const created = {
        id: 'new-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 0,
        windowStart: expect.any(Date),
        blockedUntil: expect.any(Date),
      }
      mockCreate.mockResolvedValue(created)

      const result = await blockIdentifier('10.0.0.1', 'ip')

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: '10.0.0.1',
          identifierType: 'ip',
          requestCount: 0,
          blockedUntil: expect.any(Date),
        }),
      })
      expect(result).toEqual(created)
    })

    it('should update existing record with blockedUntil', async () => {
      const existing = {
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 5,
        windowStart: new Date(),
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)

      const updated = { ...existing, blockedUntil: expect.any(Date) }
      mockUpdate.mockResolvedValue(updated)

      await blockIdentifier('10.0.0.1', 'ip')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { blockedUntil: expect.any(Date) },
      })
    })

    it('should use custom duration when provided', async () => {
      mockFindFirst.mockResolvedValue(null)
      mockCreate.mockResolvedValue({})

      const before = Date.now()
      await blockIdentifier('0xwallet1', 'wallet', 30_000) // 30 seconds
      const after = Date.now()

      const createCall = mockCreate.mock.calls[0][0]
      const blockedUntil = createCall.data.blockedUntil.getTime()

      // blockedUntil should be ~30 seconds from now
      expect(blockedUntil).toBeGreaterThanOrEqual(before + 30_000)
      expect(blockedUntil).toBeLessThanOrEqual(after + 30_000)
    })

    it('should use default 15 minute duration when no duration provided', async () => {
      mockFindFirst.mockResolvedValue(null)
      mockCreate.mockResolvedValue({})

      const before = Date.now()
      await blockIdentifier('10.0.0.1', 'ip')
      const after = Date.now()

      const createCall = mockCreate.mock.calls[0][0]
      const blockedUntil = createCall.data.blockedUntil.getTime()

      const fifteenMinutes = 15 * 60 * 1000
      expect(blockedUntil).toBeGreaterThanOrEqual(before + fifteenMinutes)
      expect(blockedUntil).toBeLessThanOrEqual(after + fifteenMinutes)
    })

    it('should respect RATE_LIMIT_BLOCK_DURATION_MS env var', async () => {
      vi.stubEnv('RATE_LIMIT_BLOCK_DURATION_MS', '60000') // 1 minute

      vi.resetModules()
      const mod = await import('../src/services/rate-limit.service.js')

      mockFindFirst.mockResolvedValue(null)
      mockCreate.mockResolvedValue({})

      const before = Date.now()
      await mod.blockIdentifier('10.0.0.1', 'ip')
      const after = Date.now()

      const createCall = mockCreate.mock.calls[0][0]
      const blockedUntil = createCall.data.blockedUntil.getTime()

      expect(blockedUntil).toBeGreaterThanOrEqual(before + 60_000)
      expect(blockedUntil).toBeLessThanOrEqual(after + 60_000)
    })

    it('should work for wallet identifierType', async () => {
      mockFindFirst.mockResolvedValue(null)
      mockCreate.mockResolvedValue({})

      await blockIdentifier('0xabc123', 'wallet')

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { identifier: '0xabc123', identifierType: 'wallet' },
      })
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: '0xabc123',
          identifierType: 'wallet',
        }),
      })
    })
  })
})
