import { createSponsorshipRequest, getSponsorshipRequest } from '../services/sponsorship.service.js'
import { getRelayTransactionByHash } from '../services/relay.service.js'
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

const getTxByHashSchema = {
  params: {
    type: 'object',
    required: ['hash'],
    properties: {
      hash: { type: 'string', minLength: 1, maxLength: 255 },
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
