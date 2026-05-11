import Fastify from 'fastify'
import pino from 'pino'
import { prisma } from '@arcpass/shared'
import { config } from './lib/config.js'
import {
  checkIpRateLimit,
  incrementIpRequestCount,
  checkWalletRateLimit,
  incrementWalletRequestCount,
  getClientIp,
} from './services/rate-limit.service.js'

// Plugins (registered in order)
import corsPlugin from './plugins/cors.js'
import securityHeadersPlugin from './plugins/security-headers.js'
import correlationIdPlugin from './plugins/correlation-id.js'
import contentTypeCheckPlugin from './plugins/content-type-check.js'
import replayProtectionPlugin from './plugins/replay-protection.js'
import errorHandlerPlugin from './plugins/error-handler.js'
import notFoundHandlerPlugin from './plugins/not-found-handler.js'

// Routes
import healthRoutes from './routes/health.js'
import walletRoutes from './routes/wallets.js'
import sponsorshipRoutes from './routes/sponsorship.js'
import relayRoutes from './routes/relay.js'

const app = Fastify({
  logger: {
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  // Disable X-Powered-By header (Fastify doesn't add it by default,
  // but explicitly ensure no server identification is exposed)
  exposeHeadRoutes: true,
})

// --- Plugin Registration (order matters) ---

// 1. CORS plugin — handles OPTIONS preflight before other hooks
app.register(corsPlugin)

// 2. Security headers — attaches headers to all responses
app.register(securityHeadersPlugin)

// 3. Correlation ID — generates/validates request IDs
app.register(correlationIdPlugin)

// 4. Content-type check — validates POST Content-Type
app.register(contentTypeCheckPlugin)

// 5. Replay protection — checks 5s deduplication window
app.register(replayProtectionPlugin)

// 6. Error handler — replaces inline setErrorHandler
app.register(errorHandlerPlugin)

// --- IP Rate Limiting (preHandler on all routes) ---
app.addHook('preHandler', async (request, reply) => {
  // Skip health check from rate limiting
  if (request.url === '/health') {
    return
  }

  const clientIp = getClientIp(request)
  await checkIpRateLimit(clientIp)
  await incrementIpRequestCount(clientIp)
})

// --- Route Registration ---
app.register(healthRoutes)
app.register(walletRoutes, { prefix: '/wallets' })
app.register(sponsorshipRoutes, { prefix: '/sponsorship' })
app.register(relayRoutes, { prefix: '/relay' })

// 7. Not-found handler (404/405) — must be registered after routes
app.register(notFoundHandlerPlugin)

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
