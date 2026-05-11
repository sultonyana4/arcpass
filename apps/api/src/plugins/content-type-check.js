import fp from 'fastify-plugin'

/**
 * Content-Type Check Plugin
 *
 * Registers a preHandler hook that validates Content-Type on POST requests.
 * Rejects requests where Content-Type is not application/json with a 400 response.
 *
 * Also re-registers the JSON parser explicitly and adds a catch-all for non-JSON
 * content types so Fastify doesn't reject with 415 before our hook runs.
 *
 * Requirements: 2.6
 */
async function contentTypeCheckPlugin(fastify) {
  // Re-register the application/json parser explicitly so it takes priority
  // over the catch-all '*' parser registered below.
  fastify.removeContentTypeParser('application/json')
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    function (request, body, done) {
      try {
        const parsed = JSON.parse(body)
        done(null, parsed)
      } catch (err) {
        done(err, undefined)
      }
    }
  )

  // Catch-all for non-JSON content types — reads body as raw string
  // so Fastify doesn't reject with 415 before our preHandler hook runs.
  fastify.addContentTypeParser('*', function (request, payload, done) {
    let data = ''
    payload.on('data', (chunk) => { data += chunk })
    payload.on('end', () => { done(null, data) })
  })

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') {
      return
    }

    const contentType = request.headers['content-type']

    if (!contentType || !contentType.startsWith('application/json')) {
      reply.code(400).send({
        error: 'Content-Type must be application/json',
        statusCode: 400,
      })
    }
  })
}

export default fp(contentTypeCheckPlugin, {
  name: 'content-type-check',
  fastify: '>=4.x',
})
