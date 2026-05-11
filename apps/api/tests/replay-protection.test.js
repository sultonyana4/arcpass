import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('@arcpass/shared', () => ({
  prisma: {
    rateLimit: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../src/services/rate-limit.service.js', () => ({
  getClientIp: vi.fn((request) => {
    const forwarded = request.headers['x-forwarded-for']
    if (forwarded) {
      const first = forwarded.split(',')[0].trim()
      if (first) return first
    }
    return request.ip
  }),
}))

import { prisma as mockPrisma } from '@arcpass/shared'
import replayProtectionPlugin from '../src/plugins/replay-protection.js'

describe('Replay Protection Plugin', () => {
  let app

  beforeEach(async () => {
    vi.clearAllMocks()

    app = Fastify({ logger: false })

    // Register a catch-all content type parser so we can send JSON bodies
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      try {
        done(null, JSON.parse(body))
      } catch (err) {
        done(err)
      }
    })

    app.register(replayProtectionPlugin)

    app.post('/sponsorship/request', async (request) => {
      return { success: true, wallet: request.body.walletAddress }
    })

    app.post('/other-route', async () => {
      return { success: true }
    })

    app.get('/sponsorship/request', async () => {
      return { success: true }
    })

    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('only applies to POST /sponsorship/request', () => {
    it('does not check replay on GET /sponsorship/request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sponsorship/request',
      })

      expect(response.statusCode).toBe(200)
      expect(mockPrisma.rateLimit.findFirst).not.toHaveBeenCalled()
    })

    it('does not check replay on POST /other-route', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/other-route',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(200)
      expect(mockPrisma.rateLimit.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('allows first request from wallet+IP', () => {
    it('allows request when no existing record found', async () => {
      mockPrisma.rateLimit.findFirst.mockResolvedValue(null)
      mockPrisma.rateLimit.create.mockResolvedValue({ id: 'new-id' })

      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().success).toBe(true)
    })

    it('creates a new rate limit record for first request', async () => {
      mockPrisma.rateLimit.findFirst.mockResolvedValue(null)
      mockPrisma.rateLimit.create.mockResolvedValue({ id: 'new-id' })

      await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
        },
      })

      expect(mockPrisma.rateLimit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: '0x1234567890abcdef1234567890abcdef12345678:192.168.1.1',
          identifierType: 'ip',
          requestCount: 1,
        }),
      })
    })
  })

  describe('rejects duplicate requests within 5-second window', () => {
    it('returns 429 when duplicate detected within window', async () => {
      const recentWindowStart = new Date(Date.now() - 2000) // 2 seconds ago

      // First findFirst call: check for record within window — found
      mockPrisma.rateLimit.findFirst.mockResolvedValueOnce({
        id: 'existing-id',
        identifier: '0x1234567890abcdef1234567890abcdef12345678:192.168.1.1',
        identifierType: 'ip',
        windowStart: recentWindowStart,
        requestCount: 1,
      })

      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
        },
      })

      expect(response.statusCode).toBe(429)
      const body = response.json()
      expect(body.error).toContain('Duplicate request detected')
      expect(body.statusCode).toBe(429)
    })

    it('includes Retry-After header with remaining seconds', async () => {
      const recentWindowStart = new Date(Date.now() - 2000) // 2 seconds ago

      mockPrisma.rateLimit.findFirst.mockResolvedValueOnce({
        id: 'existing-id',
        identifier: '0x1234567890abcdef1234567890abcdef12345678:192.168.1.1',
        identifierType: 'ip',
        windowStart: recentWindowStart,
        requestCount: 1,
      })

      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
        },
      })

      expect(response.statusCode).toBe(429)
      const retryAfter = parseInt(response.headers['retry-after'], 10)
      // Window started 2s ago, so ~3s remaining
      expect(retryAfter).toBeGreaterThanOrEqual(1)
      expect(retryAfter).toBeLessThanOrEqual(5)
    })

    it('returns Retry-After of at least 1 second', async () => {
      // Window started 4.9 seconds ago — almost expired
      const recentWindowStart = new Date(Date.now() - 4900)

      mockPrisma.rateLimit.findFirst.mockResolvedValueOnce({
        id: 'existing-id',
        identifier: '0x1234567890abcdef1234567890abcdef12345678:192.168.1.1',
        identifierType: 'ip',
        windowStart: recentWindowStart,
        requestCount: 1,
      })

      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
        },
      })

      expect(response.statusCode).toBe(429)
      const retryAfter = parseInt(response.headers['retry-after'], 10)
      expect(retryAfter).toBeGreaterThanOrEqual(1)
    })
  })

  describe('allows requests after window expires', () => {
    it('allows request when no record within window exists and updates existing record', async () => {
      // First findFirst: no record within window
      mockPrisma.rateLimit.findFirst.mockResolvedValueOnce(null)
      // Second findFirst: existing expired record found
      mockPrisma.rateLimit.findFirst.mockResolvedValueOnce({
        id: 'old-id',
        identifier: '0x1234567890abcdef1234567890abcdef12345678:192.168.1.1',
        identifierType: 'ip',
        windowStart: new Date(Date.now() - 10000), // 10 seconds ago
        requestCount: 1,
      })
      mockPrisma.rateLimit.update.mockResolvedValue({ id: 'old-id' })

      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
        },
      })

      expect(response.statusCode).toBe(200)
      expect(mockPrisma.rateLimit.update).toHaveBeenCalledWith({
        where: { id: 'old-id' },
        data: expect.objectContaining({
          requestCount: 1,
        }),
      })
    })
  })

  describe('uses composite wallet:IP identifier', () => {
    it('uses wallet address and IP in composite key', async () => {
      mockPrisma.rateLimit.findFirst.mockResolvedValue(null)
      mockPrisma.rateLimit.create.mockResolvedValue({ id: 'new-id' })

      await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '10.0.0.1',
        },
      })

      // The first findFirst checks for record within window
      expect(mockPrisma.rateLimit.findFirst).toHaveBeenCalledWith({
        where: {
          identifier: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd:10.0.0.1',
          identifierType: 'ip',
          windowStart: {
            gt: expect.any(Date),
          },
        },
      })
    })

    it('different IPs for same wallet are treated independently', async () => {
      // First request from IP 1 — no existing record
      mockPrisma.rateLimit.findFirst.mockResolvedValue(null)
      mockPrisma.rateLimit.create.mockResolvedValue({ id: 'new-id' })

      await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '10.0.0.1',
        },
      })

      // Verify the composite key uses the specific IP
      expect(mockPrisma.rateLimit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            identifier: '0x1234567890abcdef1234567890abcdef12345678:10.0.0.1',
          }),
        })
      )

      vi.clearAllMocks()
      mockPrisma.rateLimit.findFirst.mockResolvedValue(null)
      mockPrisma.rateLimit.create.mockResolvedValue({ id: 'new-id-2' })

      // Second request from IP 2 — different composite key
      await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '10.0.0.2',
        },
      })

      expect(mockPrisma.rateLimit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            identifier: '0x1234567890abcdef1234567890abcdef12345678:10.0.0.2',
          }),
        })
      )
    })
  })

  describe('handles missing wallet address gracefully', () => {
    it('skips replay check when walletAddress is not in body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { someOtherField: 'value' },
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(200)
      expect(mockPrisma.rateLimit.findFirst).not.toHaveBeenCalled()
    })

    it('skips replay check when body is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: {},
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(200)
      expect(mockPrisma.rateLimit.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('response shape on rejection', () => {
    it('returns exactly two fields: error and statusCode', async () => {
      const recentWindowStart = new Date(Date.now() - 1000)

      mockPrisma.rateLimit.findFirst.mockResolvedValueOnce({
        id: 'existing-id',
        identifier: '0x1234567890abcdef1234567890abcdef12345678:192.168.1.1',
        identifierType: 'ip',
        windowStart: recentWindowStart,
        requestCount: 1,
      })

      const response = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '192.168.1.1',
        },
      })

      const body = response.json()
      const keys = Object.keys(body)
      expect(keys).toHaveLength(2)
      expect(keys).toContain('error')
      expect(keys).toContain('statusCode')
    })
  })
})
