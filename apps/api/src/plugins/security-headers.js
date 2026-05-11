import fp from 'fastify-plugin'

/**
 * Security Headers Plugin
 *
 * Attaches standard security headers to every HTTP response via an onSend hook.
 * Conditionally sets HSTS when the request is served over HTTPS.
 * Removes the X-Powered-By header.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */
async function securityHeadersPlugin(fastify, opts) {
  // Remove X-Powered-By header by deleting it in the onSend hook
  // (Fastify doesn't set it by default, but ensure it's removed if present)

  fastify.addHook('onSend', async (request, reply) => {
    // Core security headers (always set)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('X-XSS-Protection', '0')
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    reply.header('Cache-Control', 'no-store')

    // Conditionally set HSTS when served over HTTPS
    const isHttps =
      request.protocol === 'https' ||
      opts?.enableHsts === true
    if (isHttps) {
      reply.header(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      )
    }

    // Remove X-Powered-By if present
    reply.removeHeader('X-Powered-By')
  })
}

export default fp(securityHeadersPlugin, {
  name: 'security-headers',
  fastify: '>=4.x',
})
