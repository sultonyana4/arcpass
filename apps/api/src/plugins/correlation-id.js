import crypto from 'node:crypto'
import fp from 'fastify-plugin'

/**
 * Printable ASCII range: 0x20 (space) to 0x7E (~)
 * Returns true if the string contains only printable ASCII characters.
 */
function isPrintableAscii(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x20 || code > 0x7E) {
      return false
    }
  }
  return true
}

/**
 * Validates the X-Request-ID header value.
 * Valid: 1–128 printable ASCII characters (0x20–0x7E).
 */
function isValidCorrelationId(value) {
  if (!value || typeof value !== 'string') return false
  if (value.length < 1 || value.length > 128) return false
  return isPrintableAscii(value)
}

/**
 * Correlation ID plugin for Fastify.
 *
 * - Reads X-Request-ID from incoming request headers
 * - If valid (1–128 printable ASCII chars), uses it as the correlation ID
 * - If invalid, generates a UUID v4 via crypto.randomUUID()
 * - Attaches to request.correlationId for downstream use
 * - Adds X-Request-ID to all response headers (including errors)
 */
async function correlationIdPlugin(fastify) {
  fastify.addHook('onRequest', async (request) => {
    const headerValue = request.headers['x-request-id']

    if (isValidCorrelationId(headerValue)) {
      request.correlationId = headerValue
    } else {
      request.correlationId = crypto.randomUUID()
    }
  })

  fastify.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-ID', request.correlationId)
  })
}

export default fp(correlationIdPlugin, {
  name: 'correlation-id',
  fastify: '>=4.x',
})
