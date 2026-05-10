export default async function healthRoutes(fastify, opts) {
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
    }
  })
}
