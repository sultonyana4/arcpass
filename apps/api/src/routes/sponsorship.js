import { createSponsorshipRequest, getSponsorshipRequest } from '../services/sponsorship.service.js'
import { getRelayTransactionByHash } from '../services/relay.service.js'
import { normalizeWalletAddress } from '../lib/wallet-validation.js'
import { checkWalletRateLimit, incrementWalletRequestCount } from '../services/rate-limit.service.js'

const createRequestSchema = {
  body: {
    type: 'object',
    required: ['walletAddress'],
    properties: {
      walletAddress: {
        type: 'string',
        pattern: '^0x[0-9a-fA-F]{40}$',
        maxLength: 42,
      },
    },
    additionalProperties: false,
  },
}

const getRequestSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
}

const getTxByHashSchema = {
  params: {
    type: 'object',
    required: ['hash'],
    properties: {
      hash: { type: 'string', minLength: 1, maxLength: 1024 },
    },
    additionalProperties: false,
  },
}

export default async function sponsorshipRoutes(fastify, opts) {
  // Wallet rate limiting preHandler for POST /request
  const walletRateLimitHandler = async (request) => {
    const walletAddress = request.body?.walletAddress
    if (walletAddress) {
      await checkWalletRateLimit(walletAddress)
      await incrementWalletRequestCount(walletAddress)
    }
  }

  fastify.post('/request', {
    schema: createRequestSchema,
    preHandler: [walletRateLimitHandler],
  }, async (request, reply) => {
    const walletAddress = normalizeWalletAddress(request.body.walletAddress)
    const ipAddress = request.headers['x-forwarded-for'] || request.ip
    const userAgent = request.headers['user-agent'] || null

    const sponsorshipRequest = await createSponsorshipRequest({
      walletAddress,
      ipAddress,
      userAgent,
    })

    return reply.status(201).send(sponsorshipRequest)
  })

  fastify.get('/tx/:hash', { schema: getTxByHashSchema }, async (request, reply) => {
    const { hash } = request.params
    const result = await getRelayTransactionByHash(hash)
    return reply.status(200).send(result)
  })

  fastify.get('/:id', { schema: getRequestSchema }, async (request, reply) => {
    const { id } = request.params
    const sponsorshipRequest = await getSponsorshipRequest(id)
    return reply.status(200).send(sponsorshipRequest)
  })
}
