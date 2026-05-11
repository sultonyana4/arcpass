import fp from 'fastify-plugin'

/**
 * Content-Type Check Plugin
 *
 * Registers a preHandler hook that validates Content-Type on POST requests.
 * Rejects requests where Content-Type is not application/json with a 400 response.
 *
 * Also adds a catch-all content type parser so Fastify doesn't reject with 415
 * before our hook runs.
 *
 * Requirements: 2.6
 */
async function contentTypeCheckPlugin(fastify) {
  // Add a catch-all content type parser so Fastify doesn't reject unknown
  // content types with 415 before our preHandler hook can run.
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
