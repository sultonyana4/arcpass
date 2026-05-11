import fp from 'fastify-plugin'

/**
 * Not Found Handler Plugin
 *
 * Provides consistent 404 and 405 responses:
 * - 404: { "error": "Not found", "statusCode": 404 } — identical regardless of method or path
 * - 405: { "error": "Method not allowed", "statusCode": 405 } with Allow header
 * - HEAD on GET routes: same status/headers but empty body
 *
 * Uses Fastify's onRoute hook to track registered routes and their methods,
 * then uses setNotFoundHandler to distinguish between truly unknown routes (404)
 * and known routes with unsupported methods (405).
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 18.1, 18.2, 18.3
 */
async function notFoundHandlerPlugin(fastify) {
  // Map of normalized route patterns to their supported HTTP methods
  // e.g. { '/health': Set(['GET', 'HEAD']), '/wallets/:address': Set(['GET', 'HEAD']) }
  const routeMethodMap = new Map()

  // Collect routes as they are registered
  fastify.addHook('onRoute', (routeOptions) => {
    const { url, method } = routeOptions

    if (!routeMethodMap.has(url)) {
      routeMethodMap.set(url, new Set())
    }

    const methods = Array.isArray(method) ? method : [method]
    for (const m of methods) {
      routeMethodMap.get(url).add(m.toUpperCase())
    }
  })

  // Set the not-found handler to handle both 404 and 405
  fastify.setNotFoundHandler((request, reply) => {
    const requestMethod = request.method.toUpperCase()
    const requestUrl = request.url.split('?')[0] // Strip query string

    // Check if the URL matches a known route pattern with a different method
    const allowedMethods = findAllowedMethods(requestUrl, routeMethodMap)

    if (allowedMethods && allowedMethods.size > 0) {
      // Route exists but method is not supported → 405
      // HEAD is implicitly supported on GET routes
      if (requestMethod === 'HEAD' && allowedMethods.has('GET')) {
        // HEAD on GET routes: respond with same status/headers but empty body
        reply
          .code(200)
          .header('content-type', 'application/json; charset=utf-8')
          .send('')
        return
      }

      const allowHeader = Array.from(allowedMethods).sort().join(', ')
      reply
        .code(405)
        .header('Allow', allowHeader)
        .send({ error: 'Method not allowed', statusCode: 405 })
      return
    }

    // Route does not exist → 404
    // Identical response regardless of HTTP method or path
    reply.code(404).send({ error: 'Not found', statusCode: 404 })
  })
}

/**
 * Attempts to match a request URL against registered route patterns.
 * Returns the set of allowed methods if a match is found, or null if no match.
 *
 * Handles parameterized routes (e.g., /wallets/:address) by converting
 * route patterns to regex for matching.
 *
 * @param {string} requestUrl - The incoming request URL (without query string)
 * @param {Map<string, Set<string>>} routeMethodMap - Map of route patterns to methods
 * @returns {Set<string>|null} Set of allowed methods or null if no route matches
 */
function findAllowedMethods(requestUrl, routeMethodMap) {
  // First try exact match
  if (routeMethodMap.has(requestUrl)) {
    return routeMethodMap.get(requestUrl)
  }

  // Try parameterized route matching
  for (const [pattern, methods] of routeMethodMap) {
    if (matchRoute(pattern, requestUrl)) {
      return methods
    }
  }

  return null
}

/**
 * Matches a Fastify route pattern against a request URL.
 * Supports :param style parameters and * wildcards.
 *
 * @param {string} pattern - Route pattern (e.g., '/wallets/:address')
 * @param {string} url - Request URL to match
 * @returns {boolean} Whether the URL matches the pattern
 */
function matchRoute(pattern, url) {
  // Skip exact matches (already handled)
  if (pattern === url) return true

  // Convert Fastify route pattern to regex
  // :param matches one path segment (no slashes)
  // * matches everything
  const regexStr = '^' + pattern
    .replace(/:[^/]+/g, '[^/]+')
    .replace(/\*/g, '.*')
    + '$'

  try {
    const regex = new RegExp(regexStr)
    return regex.test(url)
  } catch {
    return false
  }
}

export default fp(notFoundHandlerPlugin, {
  name: 'not-found-handler',
  fastify: '>=4.x',
})
