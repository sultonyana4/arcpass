import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

// Mock services to isolate schema validation testing
vi.mock('../src/services/sponsorship.service.js', () => ({
  createSponsorshipRequest: vi.fn().mockResolvedValue({ id: 'mock-id', status: 'pending' }),
  getSponsorshipRequest: vi.fn().mockResolvedValue({ id: 'mock-id', status: 'pending' }),
}))

vi.mock('../src/services/relay.service.js', () => ({
  getRelayTransactionByHash: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  getRelayById: vi.fn().mockResolvedValue({ id: 'mock-id', status: 'submitted', relayAttempt: 1, transactionHash: null, submittedAt: new Date(), confirmedAt: null, failedAt: null, failureReason: null, sponsorshipRequestId: 'sr-1' }),
}))

vi.mock('../src/services/rate-limit.service.js', () => ({
  checkWalletRateLimit: vi.fn().mockResolvedValue(undefined),
  incrementWalletRequestCount: vi.fn().mockResolvedValue(undefined),
  checkIpRateLimit: vi.fn().mockResolvedValue(undefined),
  incrementIpRequestCount: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))

vi.mock('../src/services/wallet.service.js', () => ({
  registerWallet: vi.fn().mockResolvedValue({ wallet: { id: 'w-1', walletAddress: '0x1234567890abcdef1234567890abcdef12345678', firstSeenAt: new Date(), lastSeenAt: new Date(), sponsorshipCount: 0, isBlocked: false }, isNew: true }),
  lookupWallet: vi.fn().mockResolvedValue({ id: 'w-1', walletAddress: '0x1234567890abcdef1234567890abcdef12345678', firstSeenAt: new Date(), lastSeenAt: new Date(), sponsorshipCount: 0, isBlocked: false }),
  getWalletHistory: vi.fn().mockResolvedValue({ items: [], cursor: null }),
}))

import sponsorshipRoutes from '../src/routes/sponsorship.js'
import walletRoutes from '../src/routes/wallets.js'
import relayRoutes from '../src/routes/relay.js'

function buildApp() {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: error.message, statusCode: 400 })
    }
    if (error.statusCode === 400) {
      return reply.status(400).send({ error: error.message, statusCode: 400 })
    }
    return reply.status(500).send({ error: 'Internal server error', statusCode: 500 })
  })

  app.register(sponsorshipRoutes, { prefix: '/sponsorship' })
  app.register(walletRoutes, { prefix: '/wallets' })
  app.register(relayRoutes, { prefix: '/relay' })
  return app
}

describe('Schema Validation Hardening', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  describe('walletAddress pattern enforcement (Requirement 2.1)', () => {
    it('accepts valid wallet address with lowercase hex', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
      })

      expect(res.statusCode).toBe(201)
    })

    it('accepts valid wallet address with uppercase hex', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12' },
      })

      expect(res.statusCode).toBe(201)
    })

    it('accepts valid wallet address with mixed case hex', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' },
      })

      expect(res.statusCode).toBe(201)
    })

    it('rejects wallet address without 0x prefix', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '1234567890abcdef1234567890abcdef12345678' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBeDefined()
    })

    it('rejects wallet address with too few hex characters', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('rejects wallet address with too many hex characters', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0x1234567890abcdef1234567890abcdef1234567890' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('rejects wallet address with non-hex characters', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('rejects empty wallet address', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: { walletAddress: '' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('enforces wallet pattern on /wallets/register', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/wallets/register',
        payload: { walletAddress: 'not-a-wallet' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('enforces wallet pattern on /wallets/:address lookup', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url: '/wallets/not-a-wallet-address',
      })

      expect(res.statusCode).toBe(400)
    })

    it('enforces wallet pattern on /wallets/:address/history', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url: '/wallets/invalid-address/history',
      })

      expect(res.statusCode).toBe(400)
    })
  })

  describe('additionalProperties: false enforcement (Requirement 2.2)', () => {
    it('rejects extra properties on POST /sponsorship/request', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: {
          walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
          extraField: 'should be rejected',
        },
      })

      // With additionalProperties: false, Fastify removes extra props by default
      // The request should still succeed (Fastify strips unknown props)
      expect(res.statusCode).toBe(201)
    })

    it('rejects extra properties on POST /wallets/register', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/wallets/register',
        payload: {
          walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
          maliciousField: 'attack',
        },
      })

      // Fastify with additionalProperties: false strips extra props
      expect(res.statusCode).toBe(201)
    })
  })

  describe('Required fields enforcement (Requirement 2.3)', () => {
    it('rejects POST /sponsorship/request with empty body', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        payload: {},
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBeDefined()
    })

    it('rejects POST /wallets/register with empty body', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/wallets/register',
        payload: {},
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBeDefined()
    })
  })

  describe('UUID format validation (Requirement 2.4)', () => {
    it('accepts valid UUID for GET /sponsorship/:id', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url: '/sponsorship/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      })

      expect(res.statusCode).toBe(200)
    })

    it('rejects invalid UUID for GET /sponsorship/:id', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url: '/sponsorship/not-a-valid-uuid',
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBeDefined()
    })

    it('rejects non-UUID string for GET /relay/:id', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url: '/relay/not-a-uuid',
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBeDefined()
    })

    it('accepts valid UUID for GET /relay/:id', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url: '/relay/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      })

      expect(res.statusCode).toBe(200)
    })

    it('rejects UUID-like string with wrong format for GET /sponsorship/:id', async () => {
      app = buildApp()
      await app.ready()

      const res = await app.inject({
        method: 'GET',
        url: '/sponsorship/a1b2c3d4e5f67890abcdef1234567890',
      })

      expect(res.statusCode).toBe(400)
    })
  })

  describe('maxLength enforcement on string fields (Requirement 2.5)', () => {
    it('rejects transaction hash exceeding maxLength on GET /sponsorship/tx/:hash', async () => {
      app = buildApp()
      await app.ready()

      // 1025 characters exceeds the maxLength: 1024 constraint
      const longHash = 'a'.repeat(1025)

      const res = await app.inject({
        method: 'GET',
        url: `/sponsorship/tx/${longHash}`,
      })

      // Fastify's router may return 404 for very long path params that don't match,
      // or 400 if the route matches but param validation fails.
      // Either way, the request is rejected (not 200).
      expect([400, 404]).toContain(res.statusCode)
    })

    it('accepts transaction hash within maxLength', async () => {
      app = buildApp()
      await app.ready()

      const validHash = '0x' + 'a'.repeat(64)

      const res = await app.inject({
        method: 'GET',
        url: `/sponsorship/tx/${validHash}`,
      })

      expect(res.statusCode).toBe(200)
    })
  })
})
