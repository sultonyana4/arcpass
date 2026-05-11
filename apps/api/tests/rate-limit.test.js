import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted to define mocks that are referenced in vi.mock factories
const { mockFindFirst, mockCreate, mockUpdate, mockConfig } = vi.hoisted(() => {
  return {
    mockFindFirst: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockConfig: {
      rateLimitIpMax: 10,
      rateLimitWindowMs: 3600000,
      rateLimitBlockDurationMs: 900000,
      rateLimitWalletMax: 5,
    },
  }
})

vi.mock('@arcpass/shared', () => ({
  prisma: {
    rateLimit: {
      findFirst: (...args) => mockFindFirst(...args),
      create: (...args) => mockCreate(...args),
      update: (...args) => mockUpdate(...args),
    },
  },
}))

vi.mock('../src/lib/config.js', () => ({
  config: mockConfig,
}))

import {
  checkIpRateLimit,
  incrementIpRequestCount,
  checkWalletRateLimit,
  incrementWalletRequestCount,
  blockIdentifier,
  getClientIp,
} from '../src/services/rate-limit.service.js'
import { RateLimitError } from '../src/lib/errors.js'

describe('Rate Limit Service', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
    mockCreate.mockReset()
    mockUpdate.mockReset()
    // Reset config to defaults
    mockConfig.rateLimitIpMax = 10
    mockConfig.rateLimitWindowMs = 3600000
    mockConfig.rateLimitBlockDurationMs = 900000
    mockConfig.rateLimitWalletMax = 5
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getClientIp', () => {
    it('should return X-Forwarded-For header value when present', () => {
      const request = {
        headers: { 'x-forwarded-for': '203.0.113.50' },
        ip: '10.0.0.1',
      }
      expect(getClientIp(request)).toBe('203.0.113.50')
    })

    it('should return first IP from X-Forwarded-For when multiple are present', () => {
      const request = {
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178' },
        ip: '10.0.0.1',
      }
      expect(getClientIp(request)).toBe('203.0.113.50')
    })

    it('should trim whitespace from X-Forwarded-For value', () => {
      const request = {
        headers: { 'x-forwarded-for': '  203.0.113.50  , 70.41.3.18' },
        ip: '10.0.0.1',
      }
      expect(getClientIp(request)).toBe('203.0.113.50')
    })

    it('should fallback to request.ip when X-Forwarded-For is not present', () => {
      const request = {
        headers: {},
        ip: '10.0.0.1',
      }
      expect(getClientIp(request)).toBe('10.0.0.1')
    })

    it('should fallback to request.ip when X-Forwarded-For is empty string', () => {
      const request = {
        headers: { 'x-forwarded-for': '' },
        ip: '10.0.0.1',
      }
      expect(getClientIp(request)).toBe('10.0.0.1')
    })
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

    it('should respect custom rateLimitIpMax from config', async () => {
      mockConfig.rateLimitIpMax = 5

      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 5,
        windowStart,
        blockedUntil: null,
      })

      await expect(checkIpRateLimit('10.0.0.1')).rejects.toThrow(RateLimitError)
    })

    it('should respect custom rateLimitWindowMs from config', async () => {
      // Set window to 5 minutes
      mockConfig.rateLimitWindowMs = 300000

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

      await expect(checkIpRateLimit('10.0.0.1')).resolves.toBeUndefined()
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

    it('should set blockedUntil using config.rateLimitBlockDurationMs', async () => {
      mockConfig.rateLimitBlockDurationMs = 60000 // 1 minute

      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      const existing = {
        id: 'rec-1',
        identifier: '10.0.0.1',
        identifierType: 'ip',
        requestCount: 9,
        windowStart,
        blockedUntil: null,
      }
      mockFindFirst.mockResolvedValue(existing)
      mockUpdate.mockResolvedValue({})

      const before = Date.now()
      await incrementIpRequestCount('10.0.0.1')
      const after = Date.now()

      const updateCall = mockUpdate.mock.calls[0][0]
      const blockedUntil = updateCall.data.blockedUntil.getTime()

      expect(blockedUntil).toBeGreaterThanOrEqual(before + 60000)
      expect(blockedUntil).toBeLessThanOrEqual(after + 60000)
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

    it('should include retryAfter when wallet count exceeds limit (not yet blocked)', async () => {
      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 5,
        windowStart,
        blockedUntil: null,
      })

      try {
        await checkWalletRateLimit('0xabc123')
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError)
        expect(err.retryAfter).toBeGreaterThan(0)
        // retryAfter should be based on block duration (default 900000ms = 900s)
        expect(err.retryAfter).toBe(Math.ceil(mockConfig.rateLimitBlockDurationMs / 1000))
      }
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

    it('should respect custom rateLimitWalletMax from config', async () => {
      mockConfig.rateLimitWalletMax = 3

      const windowStart = new Date(Date.now() - 30 * 60 * 1000)
      mockFindFirst.mockResolvedValue({
        id: 'rec-1',
        identifier: '0xabc123',
        identifierType: 'wallet',
        requestCount: 3,
        windowStart,
        blockedUntil: null,
      })

      await expect(checkWalletRateLimit('0xabc123')).rejects.toThrow(RateLimitError)
    })

    it('should respect custom rateLimitWindowMs from config for wallet checks', async () => {
      mockConfig.rateLimitWindowMs = 300000 // 5 minutes

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

      await expect(checkWalletRateLimit('0xabc123')).resolves.toBeUndefined()
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

    it('should use config.rateLimitBlockDurationMs when no duration provided', async () => {
      mockConfig.rateLimitBlockDurationMs = 900000 // 15 minutes

      mockFindFirst.mockResolvedValue(null)
      mockCreate.mockResolvedValue({})

      const before = Date.now()
      await blockIdentifier('10.0.0.1', 'ip')
      const after = Date.now()

      const createCall = mockCreate.mock.calls[0][0]
      const blockedUntil = createCall.data.blockedUntil.getTime()

      expect(blockedUntil).toBeGreaterThanOrEqual(before + 900000)
      expect(blockedUntil).toBeLessThanOrEqual(after + 900000)
    })

    it('should respect custom rateLimitBlockDurationMs from config', async () => {
      mockConfig.rateLimitBlockDurationMs = 60000 // 1 minute

      mockFindFirst.mockResolvedValue(null)
      mockCreate.mockResolvedValue({})

      const before = Date.now()
      await blockIdentifier('10.0.0.1', 'ip')
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
