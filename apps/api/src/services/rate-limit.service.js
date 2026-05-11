import { prisma } from '@arcpass/shared'
import { config } from '../lib/config.js'
import { RateLimitError } from '../lib/errors.js'

/**
 * Extracts the client IP address from a Fastify request.
 * Uses X-Forwarded-For header when present, falling back to direct connection IP.
 *
 * @param {object} request - Fastify request object
 * @returns {string} The client IP address
 */
export function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for']
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs; use the first (client IP)
    const first = forwarded.split(',')[0].trim()
    if (first) return first
  }
  return request.ip
}

/**
 * Temporarily blocks an identifier (IP or wallet) for a specified duration.
 * Sets the `blockedUntil` field on the RateLimit record.
 * If no record exists, creates one with blockedUntil set.
 *
 * @param {string} identifier - The IP address or wallet address to block
 * @param {'ip' | 'wallet'} identifierType - The type of identifier
 * @param {number} [durationMs] - Block duration in milliseconds (defaults to config.rateLimitBlockDurationMs)
 * @returns {Promise<object>} The updated or created rate limit record
 */
export async function blockIdentifier(identifier, identifierType, durationMs) {
  const duration = durationMs ?? config.rateLimitBlockDurationMs
  const blockedUntil = new Date(Date.now() + duration)

  const existing = await prisma.rateLimit.findFirst({
    where: { identifier, identifierType },
  })

  if (!existing) {
    return prisma.rateLimit.create({
      data: {
        identifier,
        identifierType,
        requestCount: 0,
        windowStart: new Date(),
        blockedUntil,
      },
    })
  }

  return prisma.rateLimit.update({
    where: { id: existing.id },
    data: { blockedUntil },
  })
}

/**
 * Checks if an IP address has exceeded the rate limit.
 * Throws RateLimitError if the IP is blocked or has exceeded the request limit.
 *
 * Sliding window logic:
 * - If blocked (blockedUntil > now): reject with 429 + Retry-After
 * - If window expired: allow (counter will reset on next increment)
 * - If request count >= max within active window: reject with 429
 *
 * @param {string} ipAddress - The IP address to check
 * @throws {RateLimitError} if rate limit is exceeded or IP is temporarily blocked
 */
export async function checkIpRateLimit(ipAddress) {
  const record = await prisma.rateLimit.findFirst({
    where: {
      identifier: ipAddress,
      identifierType: 'ip',
    },
  })

  if (!record) {
    return
  }

  const now = new Date()

  // Check if IP is temporarily blocked
  if (record.blockedUntil && record.blockedUntil > now) {
    const retryAfter = Math.ceil((record.blockedUntil.getTime() - now.getTime()) / 1000)
    throw new RateLimitError('Too many requests. Please try again later.', { retryAfter })
  }

  const windowStart = record.windowStart.getTime()
  const windowEnd = windowStart + config.rateLimitWindowMs

  // If window has expired, the counter will be reset on next increment — allow request
  if (now.getTime() >= windowEnd) {
    return
  }

  // Check if request count exceeds limit within active window
  if (record.requestCount >= config.rateLimitIpMax) {
    throw new RateLimitError('Too many requests. Please try again later.')
  }
}

/**
 * Increments the request counter for an IP address.
 * Resets the window if it has expired. Clears block if blockedUntil has passed.
 * Auto-blocks when count reaches the configured max.
 *
 * @param {string} ipAddress - The IP address to track
 * @returns {Promise<object>} The updated rate limit record
 */
export async function incrementIpRequestCount(ipAddress) {
  const now = new Date()

  const existing = await prisma.rateLimit.findFirst({
    where: {
      identifier: ipAddress,
      identifierType: 'ip',
    },
  })

  if (!existing) {
    return prisma.rateLimit.create({
      data: {
        identifier: ipAddress,
        identifierType: 'ip',
        requestCount: 1,
        windowStart: now,
      },
    })
  }

  const windowEnd = existing.windowStart.getTime() + config.rateLimitWindowMs

  // Window expired — reset counter and clear any expired block
  if (now.getTime() >= windowEnd) {
    return prisma.rateLimit.update({
      where: { id: existing.id },
      data: {
        requestCount: 1,
        windowStart: now,
        blockedUntil: null,
      },
    })
  }

  // Window still active — increment counter
  const newCount = existing.requestCount + 1

  // Auto-block when limit is reached
  if (newCount >= config.rateLimitIpMax) {
    return prisma.rateLimit.update({
      where: { id: existing.id },
      data: {
        requestCount: newCount,
        blockedUntil: new Date(Date.now() + config.rateLimitBlockDurationMs),
      },
    })
  }

  return prisma.rateLimit.update({
    where: { id: existing.id },
    data: {
      requestCount: newCount,
    },
  })
}

/**
 * Checks if a wallet has exceeded the rate limit.
 * Throws RateLimitError if the wallet is blocked or has exceeded the request limit.
 *
 * @param {string} walletAddress - The wallet address to check
 * @throws {RateLimitError} if rate limit is exceeded or wallet is temporarily blocked
 */
export async function checkWalletRateLimit(walletAddress) {
  const record = await prisma.rateLimit.findFirst({
    where: {
      identifier: walletAddress,
      identifierType: 'wallet',
    },
  })

  if (!record) {
    return
  }

  const now = new Date()

  // Check if wallet is temporarily blocked
  if (record.blockedUntil && record.blockedUntil > now) {
    const retryAfter = Math.ceil((record.blockedUntil.getTime() - now.getTime()) / 1000)
    throw new RateLimitError('Too many requests. Please try again later.', { retryAfter })
  }

  const windowStart = record.windowStart.getTime()
  const windowEnd = windowStart + config.rateLimitWindowMs

  // If window has expired, the counter will be reset on next increment — allow request
  if (now.getTime() >= windowEnd) {
    return
  }

  // Check if request count exceeds limit within active window
  if (record.requestCount >= config.rateLimitWalletMax) {
    // Compute retryAfter based on block duration from now (block will be set on increment)
    const retryAfter = Math.ceil(config.rateLimitBlockDurationMs / 1000)
    throw new RateLimitError('Too many requests. Please try again later.', { retryAfter })
  }
}

/**
 * Increments the request counter for a wallet address.
 * Resets the window if it has expired. Clears block if blockedUntil has passed.
 * Auto-blocks when count reaches the configured max.
 *
 * @param {string} walletAddress - The wallet address to track
 * @returns {Promise<object>} The updated rate limit record
 */
export async function incrementWalletRequestCount(walletAddress) {
  const now = new Date()

  const existing = await prisma.rateLimit.findFirst({
    where: {
      identifier: walletAddress,
      identifierType: 'wallet',
    },
  })

  if (!existing) {
    return prisma.rateLimit.create({
      data: {
        identifier: walletAddress,
        identifierType: 'wallet',
        requestCount: 1,
        windowStart: now,
      },
    })
  }

  const windowEnd = existing.windowStart.getTime() + config.rateLimitWindowMs

  // Window expired — reset counter and clear any expired block
  if (now.getTime() >= windowEnd) {
    return prisma.rateLimit.update({
      where: { id: existing.id },
      data: {
        requestCount: 1,
        windowStart: now,
        blockedUntil: null,
      },
    })
  }

  // Window still active — increment counter
  const newCount = existing.requestCount + 1

  // Auto-block when limit is reached
  if (newCount >= config.rateLimitWalletMax) {
    return prisma.rateLimit.update({
      where: { id: existing.id },
      data: {
        requestCount: newCount,
        blockedUntil: new Date(Date.now() + config.rateLimitBlockDurationMs),
      },
    })
  }

  return prisma.rateLimit.update({
    where: { id: existing.id },
    data: {
      requestCount: newCount,
    },
  })
}
