import fp from 'fastify-plugin'
import { prisma } from '@arcpass/shared'
import { getClientIp } from '../services/rate-limit.service.js'

const REPLAY_WINDOW_MS = 5000 // 5-second deduplication window

/**
 * Replay Protection Plugin
 *
 * Registers a preHandler hook on POST /sponsorship/request that prevents
 * duplicate requests from the same wallet+IP within a 5-second window.
 *
 * Uses the RateLimit table with identifierType 'ip' and a composite
 * identifier of '{walletAddress}:{clientIp}' to track request timestamps.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
async function replayProtectionPlugin(fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    // Only apply to POST /sponsorship/request
    if (request.method !== 'POST' || request.url !== '/sponsorship/request') {
      return
    }

    const walletAddress = request.body?.walletAddress
    if (!walletAddress) {
      return
    }

    const clientIp = getClientIp(request)
    const compositeKey = `${walletAddress}:${clientIp}`
    const now = new Date()
    const windowStart = new Date(now.getTime() - REPLAY_WINDOW_MS)

    // Check for existing record within the 5-second window
    const existing = await prisma.rateLimit.findFirst({
      where: {
        identifier: compositeKey,
        identifierType: 'ip',
        windowStart: {
          gt: windowStart,
        },
      },
    })

    if (existing) {
      // Calculate remaining seconds in the deduplication window
      const windowEnd = existing.windowStart.getTime() + REPLAY_WINDOW_MS
      const remainingMs = windowEnd - now.getTime()
      const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000))

      reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .send({
          error: 'Duplicate request detected. Please wait before retrying.',
          statusCode: 429,
        })
      return
    }

    // Record timestamp for future comparison — upsert to handle existing expired records
    const existingRecord = await prisma.rateLimit.findFirst({
      where: {
        identifier: compositeKey,
        identifierType: 'ip',
      },
    })

    if (existingRecord) {
      await prisma.rateLimit.update({
        where: { id: existingRecord.id },
        data: {
          windowStart: now,
          requestCount: 1,
        },
      })
    } else {
      await prisma.rateLimit.create({
        data: {
          identifier: compositeKey,
          identifierType: 'ip',
          requestCount: 1,
          windowStart: now,
        },
      })
    }
  })
}

export default fp(replayProtectionPlugin, {
  name: 'replay-protection',
  fastify: '>=4.x',
})
