import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@arcpass/shared', () => ({
  prisma: {
    relayTransaction: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@arcpass/shared'

// Dynamically import the route after mocking
const { default: relayRoutes } = await import('../src/routes/relay.js')

// Minimal Fastify mock for route testing
function createFastifyMock() {
  const routes = {}
  return {
    get: (path, opts, handler) => {
      routes[`GET ${path}`] = { opts, handler }
    },
    routes,
  }
}

describe('relay routes', () => {
  let fastify
  let handler

  beforeEach(async () => {
    vi.clearAllMocks()
    fastify = createFastifyMock()
    await relayRoutes(fastify, {})
    handler = fastify.routes['GET /:id'].handler
  })

  it('registers GET /:id route with uuid schema', async () => {
    const route = fastify.routes['GET /:id']
    expect(route).toBeDefined()
    expect(route.opts.schema.params.properties.id.format).toBe('uuid')
  })

  it('returns formatted relay transaction when found', async () => {
    const submittedAt = new Date('2025-01-15T10:30:00Z')
    const mockRelay = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      sponsorshipRequestId: '660e8400-e29b-41d4-a716-446655440000',
      status: 'submitted',
      relayAttempt: 1,
      transactionHash: '0xabc123def456',
      submittedAt,
      confirmedAt: null,
      failedAt: null,
      failureReason: null,
    }
    prisma.relayTransaction.findUnique.mockResolvedValue(mockRelay)

    const request = { params: { id: '550e8400-e29b-41d4-a716-446655440000' } }
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }

    await handler(request, reply)

    expect(reply.status).toHaveBeenCalledWith(200)
    expect(reply.send).toHaveBeenCalledWith({
      id: '550e8400-e29b-41d4-a716-446655440000',
      sponsorshipRequestId: '660e8400-e29b-41d4-a716-446655440000',
      status: 'submitted',
      relayAttempt: 1,
      transactionHash: '0xabc123def456',
      submittedAt: '2025-01-15T10:30:00.000Z',
      confirmedAt: null,
      failedAt: null,
      failureReason: null,
    })
  })

  it('returns 404 when relay transaction not found', async () => {
    prisma.relayTransaction.findUnique.mockResolvedValue(null)

    const request = { params: { id: '550e8400-e29b-41d4-a716-446655440000' } }
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }

    await handler(request, reply)

    expect(reply.status).toHaveBeenCalledWith(404)
    expect(reply.send).toHaveBeenCalledWith({
      error: 'Relay transaction not found',
      statusCode: 404,
    })
  })

  it('formats all null timestamps correctly', async () => {
    const mockRelay = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      sponsorshipRequestId: '660e8400-e29b-41d4-a716-446655440000',
      status: 'queued',
      relayAttempt: 1,
      transactionHash: null,
      submittedAt: null,
      confirmedAt: null,
      failedAt: null,
      failureReason: null,
    }
    prisma.relayTransaction.findUnique.mockResolvedValue(mockRelay)

    const request = { params: { id: '550e8400-e29b-41d4-a716-446655440000' } }
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }

    await handler(request, reply)

    const response = reply.send.mock.calls[0][0]
    expect(response.transactionHash).toBeNull()
    expect(response.submittedAt).toBeNull()
    expect(response.confirmedAt).toBeNull()
    expect(response.failedAt).toBeNull()
    expect(response.failureReason).toBeNull()
  })

  it('formats confirmed relay transaction with all timestamps', async () => {
    const mockRelay = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      sponsorshipRequestId: '660e8400-e29b-41d4-a716-446655440000',
      status: 'confirmed',
      relayAttempt: 2,
      transactionHash: '0xdef789',
      submittedAt: new Date('2025-01-15T10:30:00Z'),
      confirmedAt: new Date('2025-01-15T10:31:00Z'),
      failedAt: null,
      failureReason: null,
    }
    prisma.relayTransaction.findUnique.mockResolvedValue(mockRelay)

    const request = { params: { id: '550e8400-e29b-41d4-a716-446655440000' } }
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() }

    await handler(request, reply)

    const response = reply.send.mock.calls[0][0]
    expect(response.status).toBe('confirmed')
    expect(response.relayAttempt).toBe(2)
    expect(response.submittedAt).toBe('2025-01-15T10:30:00.000Z')
    expect(response.confirmedAt).toBe('2025-01-15T10:31:00.000Z')
  })
})
