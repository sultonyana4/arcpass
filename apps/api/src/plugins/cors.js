import fp from 'fastify-plugin'
import { config } from '../lib/config.js'

/**
 * Custom CORS plugin for strict origin allowlist enforcement.
 *
 * Behavior:
 * - Parses CORS_ALLOWED_ORIGINS from config (comma-separated, trimmed)
 * - If empty/unset, omits all CORS headers (blocks all cross-origin)
 * - If origin not in allowlist, omits all Access-Control-* headers
 * - For allowed origins: sets Access-Control-Allow-Origin, Allow-Methods, Allow-Headers
 * - Never sends Access-Control-Allow-Credentials: true
 * - Handles preflight OPTIONS requests with 204 for allowed origins
 */
async function corsPlugin(fastify) {
  const allowedOrigins = config.corsAllowedOrigins
  const allowedMethods = 'GET, POST, OPTIONS'
  const allowedHeaders = 'Content-Type, Authorization'

  /**
   * Checks if the given origin is in the allowlist.
   * @param {string|undefined} origin
   * @returns {boolean}
   */
  function isOriginAllowed(origin) {
    if (!origin || allowedOrigins.length === 0) {
      return false
    }
    return allowedOrigins.includes(origin)
  }

  // Handle preflight OPTIONS requests
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'OPTIONS') {
      return
    }

    const origin = request.headers.origin

    if (!isOriginAllowed(origin)) {
      // No CORS headers — browser will block the preflight
      reply.status(204).send()
      return
    }

    // Allowed origin — respond with CORS headers and 204
    reply
      .header('Access-Control-Allow-Origin', origin)
      .header('Access-Control-Allow-Methods', allowedMethods)
      .header('Access-Control-Allow-Headers', allowedHeaders)
      .status(204)
      .send()
  })

  // Add CORS headers to all non-preflight responses for allowed origins
  fastify.addHook('onSend', async (request, reply) => {
    // Skip if this was already handled as a preflight
    if (request.method === 'OPTIONS') {
      return
    }

    const origin = request.headers.origin

    if (!isOriginAllowed(origin)) {
      return
    }

    reply.header('Access-Control-Allow-Origin', origin)
    reply.header('Access-Control-Allow-Methods', allowedMethods)
    reply.header('Access-Control-Allow-Headers', allowedHeaders)
  })
}

export default fp(corsPlugin, {
  name: 'cors',
})
