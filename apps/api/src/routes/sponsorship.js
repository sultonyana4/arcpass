import { createSponsorshipRequest, getSponsorshipRequest } from '../services/sponsorship.service.js'
import { normalizeWalletAddress } from '../lib/wallet-validation.js'

const createRequestSchema = {
  body: {
    type: 'object',
    required: ['walletAddress'],
    properties: {
      walletAddress: { type: 'string', minLength: 42, maxLength: 44 },
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
  },
}

export default async function sponsorshipRoutes(fastify, opts) {
  fastify.post('/request', { schema: createRequestSchema }, async (request, reply) => {
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

  fastify.get('/:id', { schema: getRequestSchema }, async (request, reply) => {
    const { id } = request.params
    const sponsorshipRequest = await getSponsorshipRequest(id)
    return reply.status(200).send(sponsorshipRequest)
  })
}
