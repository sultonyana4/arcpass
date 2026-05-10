import { getRelayById } from '../services/relay.service.js'

const getRelaySchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
}

/**
 * Formats a relay transaction record for the API response.
 * Converts Date objects to ISO 8601 strings.
 *
 * @param {object} relay - The relay transaction record from the database
 * @returns {object} Formatted relay response
 */
function formatRelayResponse(relay) {
  return {
    id: relay.id,
    sponsorshipRequestId: relay.sponsorshipRequestId,
    status: relay.status,
    relayAttempt: relay.relayAttempt,
    transactionHash: relay.transactionHash || null,
    submittedAt: relay.submittedAt ? relay.submittedAt.toISOString() : null,
    confirmedAt: relay.confirmedAt ? relay.confirmedAt.toISOString() : null,
    failedAt: relay.failedAt ? relay.failedAt.toISOString() : null,
    failureReason: relay.failureReason || null,
  }
}

export default async function relayRoutes(fastify, opts) {
  fastify.get('/:id', { schema: getRelaySchema }, async (request, reply) => {
    const { id } = request.params
    const relay = await getRelayById(id)

    if (!relay) {
      return reply.status(404).send({
        error: 'Relay transaction not found',
        statusCode: 404,
      })
    }

    return reply.status(200).send(formatRelayResponse(relay))
  })
}
