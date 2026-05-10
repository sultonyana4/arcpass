import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { SponsorshipNotFoundError, ValidationError } from '../src/lib/errors.js'

vi.mock('../src/services/sponsorship.service.js', () => ({
  createSponsorshipRequest: vi.fn(),
  getSponsorshipRequest: vi.fn(),
}))

vi.mock('../src/services/relay.service.js', () => ({
  getRelayTransactionByHash: vi.fn(),
}))

import { createSponsorshipRequest, getSponsorshipRequest } from '../src/services/sponsorship.service.js'
import { getRelayTransactionByHash } from '../src/services/relay.service.js'
import sponsorshipRoutes from '../src/routes/sponsorship.js'

function buildApp() {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: error.message, statusCode: 400 })
    }
    if (error.statusCode === 400) {
      return reply.status(400).send({ error: error.message, statusCode: 400 })
    }
    if (error instanceof ValidationError) {
      return reply.status(400).send({ error: error.message, statusCode: 400 })
    }
    if (error instanceof SponsorshipNotFoundError) {
      return reply.status(404).send({ error: error.message, statusCode: 404 })
    }
    request.log.error(error)
    return reply.status(500).send({ error: 'Internal server error', statusCode: 500 })
  })

  app.register(sponsorshipRoutes, { prefix: '/sponsorship' })
  return app
}

describe('GET /sponsorship/:id', () => {
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

  it('returns 200 with sponsorship request data when found', async () => {
    const mockRequest = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      walletId: 'wallet-uuid-1',
      status: 'pending',
      ipAddress: '192.168.1.1',
      userAgent: 'TestAgent/1.0',
      wallet: { id: 'wallet-uuid-1', walletAddress: '0xabc123' },
    }
    getSponsorshipRequest.mockResolvedValue(mockRequest)

    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/sponsorship/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(mockRequest)
    expect(getSponsorshipRequest).toHaveBeenCalledWith('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('returns 404 when sponsorship request is not found', async () => {
    getSponsorshipRequest.mockRejectedValue(
      new SponsorshipNotFoundError('Sponsorship request not found')
    )

    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/sponsorship/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      error: 'Sponsorship request not found',
      statusCode: 404,
    })
  })

  it('returns 400 for invalid UUID format', async () => {
    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/sponsorship/not-a-valid-uuid',
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.statusCode).toBe(400)
    expect(body.error).toBeDefined()
  })

  it('delegates to getSponsorshipRequest with the id param', async () => {
    const testId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    getSponsorshipRequest.mockResolvedValue({ id: testId, status: 'approved' })

    app = buildApp()
    await app.ready()

    await app.inject({
      method: 'GET',
      url: `/sponsorship/${testId}`,
    })

    expect(getSponsorshipRequest).toHaveBeenCalledTimes(1)
    expect(getSponsorshipRequest).toHaveBeenCalledWith(testId)
  })
})

describe('POST /sponsorship/request', () => {
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

  it('returns 201 with created sponsorship request for valid wallet address', async () => {
    const mockResult = {
      id: 'req-uuid-1',
      walletId: 'wallet-uuid-1',
      status: 'pending',
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
    }
    createSponsorshipRequest.mockResolvedValue(mockResult)

    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      payload: { walletAddress: '0x1234567890abcdef1234567890abcdef12345678' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual(mockResult)
    expect(createSponsorshipRequest).toHaveBeenCalledWith({
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      ipAddress: '127.0.0.1',
      userAgent: expect.any(String),
    })
  })

  it('normalizes wallet address to lowercase before passing to service', async () => {
    createSponsorshipRequest.mockResolvedValue({ id: 'req-1', status: 'pending' })

    app = buildApp()
    await app.ready()

    await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      payload: { walletAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' },
    })

    expect(createSponsorshipRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
      })
    )
  })

  it('returns 400 when walletAddress is missing', async () => {
    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().statusCode).toBe(400)
  })

  it('returns 400 when walletAddress is not a string', async () => {
    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      payload: { walletAddress: 12345 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().statusCode).toBe(400)
  })

  it('returns 400 when walletAddress is too short', async () => {
    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      payload: { walletAddress: '0x1234' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().statusCode).toBe(400)
  })

  it('returns 400 when walletAddress has invalid hex format', async () => {
    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      payload: { walletAddress: '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().statusCode).toBe(400)
  })

  it('strips additional properties from request body', async () => {
    createSponsorshipRequest.mockResolvedValue({ id: 'req-1', status: 'pending' })

    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      payload: {
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        extraField: 'should be stripped',
      },
    })

    // Fastify removes additional properties by default with additionalProperties: false
    expect(res.statusCode).toBe(201)
    expect(createSponsorshipRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      })
    )
  })

  it('returns 400 when body is not valid JSON', async () => {
    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: 'not-json',
    })

    expect(res.statusCode).toBe(400)
  })
})


describe('GET /sponsorship/tx/:hash', () => {
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

  it('returns 200 with sponsorship request and relay transaction when hash is found', async () => {
    const mockResult = {
      sponsorshipRequest: {
        id: 'sr-uuid-1',
        walletId: 'wallet-uuid-1',
        status: 'completed',
        requestedAt: '2025-01-01T00:00:00.000Z',
      },
      relayTransaction: {
        id: 'rt-uuid-1',
        sponsorshipRequestId: 'sr-uuid-1',
        status: 'confirmed',
        relayAttempt: 1,
        transactionHash: '0xabc123def456',
        submittedAt: '2025-01-01T00:00:00.000Z',
        confirmedAt: '2025-01-01T00:01:00.000Z',
        failedAt: null,
        failureReason: null,
      },
    }
    getRelayTransactionByHash.mockResolvedValue(mockResult)

    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/sponsorship/tx/0xabc123def456',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(mockResult)
    expect(getRelayTransactionByHash).toHaveBeenCalledWith('0xabc123def456')
  })

  it('returns 404 when no transaction matches the hash', async () => {
    getRelayTransactionByHash.mockRejectedValue(
      new SponsorshipNotFoundError('Transaction not found')
    )

    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/sponsorship/tx/0xnonexistent',
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      error: 'Transaction not found',
      statusCode: 404,
    })
  })

  it('returns 400 when hash is empty', async () => {
    app = buildApp()
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/sponsorship/tx/',
    })

    // Fastify validates minLength: 1 on the param schema
    expect(res.statusCode).toBe(400)
  })

  it('passes the hash parameter directly to the service', async () => {
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    getRelayTransactionByHash.mockResolvedValue({
      sponsorshipRequest: { id: 'sr-1' },
      relayTransaction: { id: 'rt-1', transactionHash: txHash },
    })

    app = buildApp()
    await app.ready()

    await app.inject({
      method: 'GET',
      url: `/sponsorship/tx/${txHash}`,
    })

    expect(getRelayTransactionByHash).toHaveBeenCalledTimes(1)
    expect(getRelayTransactionByHash).toHaveBeenCalledWith(txHash)
  })
})
