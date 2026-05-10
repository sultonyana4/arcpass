import Fastify from 'fastify'
import pino from 'pino'
import { prisma } from '@arcpass/shared'
import { config } from './lib/config.js'
import { ValidationError, BlockedWalletError, WalletNotFoundError, SponsorshipNotFoundError, RateLimitError } from './lib/errors.js'
import healthRoutes from './routes/health.js'
import walletRoutes from './routes/wallets.js'
import sponsorshipRoutes from './routes/sponsorship.js'

const app = Fastify({
  logger: {
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
})

// Custom error handler — maps errors to standard response shape
app.setErrorHandler((error, request, reply) => {
  if (error.validation) {
    return reply.status(400).send({
      error: error.message,
      statusCode: 400,
    })
  }

  // Handle JSON parse errors and other Fastify 400-level errors (e.g., malformed body)
  if (error.statusCode === 400) {
    return reply.status(400).send({ error: error.message, statusCode: 400 })
  }

  if (error instanceof ValidationError) {
    return reply.status(400).send({ error: error.message, statusCode: 400 })
  }

  if (error instanceof BlockedWalletError) {
    return reply.status(403).send({ error: error.message, statusCode: 403 })
  }

  if (error instanceof WalletNotFoundError) {
    return reply.status(404).send({ error: error.message, statusCode: 404 })
  }

  if (error instanceof SponsorshipNotFoundError) {
    return reply.status(404).send({ error: error.message, statusCode: 404 })
  }

  if (error instanceof RateLimitError) {
    const response = { error: error.message, statusCode: 429 }
    if (error.retryAfter) {
      reply.header('Retry-After', error.retryAfter)
    }
    return reply.status(429).send(response)
  }

  // Unexpected error — log full details and return sanitized response
  request.log.error(error)
  return reply.status(500).send({
    error: 'Internal server error',
    statusCode: 500,
  })
})

// Register plugins (cross-cutting concerns)
// Plugins from plugins/ directory will be registered here as they are added

// Register routes
app.register(healthRoutes)
app.register(walletRoutes, { prefix: '/wallets' })
app.register(sponsorshipRoutes, { prefix: '/sponsorship' })

async function start() {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

function shutdown(signal) {
  app.log.info({ signal }, 'Received signal, shutting down')
  const forceExit = setTimeout(() => {
    app.log.error('Shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  prisma.$disconnect().then(() => {
    return app.close()
  }).then(() => {
    clearTimeout(forceExit)
    process.exit(0)
  }).catch((err) => {
    app.log.error(err, 'Error during shutdown')
    clearTimeout(forceExit)
    process.exit(1)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

start()
