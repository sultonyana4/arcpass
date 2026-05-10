import { prisma } from '@arcpass/shared'
import { RateLimitError } from '../lib/errors.js'

const DEFAULT_IP_MAX_REQUESTS = 10
const DEFAULT_WALLET_MAX_REQUESTS = 5
const DEFAULT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const DEFAULT_BLOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Returns the configured max requests per IP per window.
 * @returns {number}
 */
function getIpMaxRequests() {
  const envVal = process.env.RATE_LIMIT_IP_MAX
  if (envVal !== undefined) {
    const parsed = Number(envVal)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_IP_MAX_REQUESTS
}

/**
 * Returns the configured max requests per wallet per window.
 * @returns {number}
 */
function getWalletMaxRequests() {
  const envVal = process.env.RATE_LIMIT_WALLET_MAX
  if (envVal !== undefined) {
    const parsed = Number(envVal)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_WALLET_MAX_REQUESTS
}

/**
 * Returns the configured window duration in milliseconds.
 * @returns {number}
 */
function getWindowMs() {
  const envVal = process.env.RATE_LIMIT_WINDOW_MS
  if (envVal !== undefined) {
    const parsed = Number(envVal)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_WINDOW_MS
}

/**
 * Returns the configured block duration in milliseconds.
 * @returns {number}
 */
function getBlockDurationMs() {
  const envVal = process.env.RATE_LIMIT_BLOCK_DURATION_MS
  if (envVal !== undefined) {
    const parsed = Number(envVal)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_BLOCK_DURATION_MS
}

/**
 * Temporarily blocks an identifier (IP or wallet) for a specified duration.
 * Sets the `blockedUntil` field on the RateLimit record.
 * If no record exists, creates one with blockedUntil set.
 *
 * @param {string} identifier - The IP address or wallet address to block
 * @param {'ip' | 'wallet'} identifierType - The type of identifier
 * @param {number} [durationMs] - Block duration in milliseconds (defaults to RATE_LIMIT_BLOCK_DURATION_MS or 15 minutes)
 * @returns {Promise<object>} The updated or created rate limit record
 */
export async function blockIdentifier(identifier, identifierType, durationMs) {
  const duration = durationMs ?? getBlockDurationMs()
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

  const windowMs = getWindowMs()
  const windowStart = record.windowStart.getTime()
  const windowEnd = windowStart + windowMs

  // If window has expired, the counter will be reset on next increment — allow request
  if (now.getTime() >= windowEnd) {
    return
  }

  // Check if request count exceeds limit within active window
  const maxRequests = getIpMaxRequests()
  if (record.requestCount >= maxRequests) {
    throw new RateLimitError('Too many requests. Please try again later.')
  }
}

/**
 * Increments the request counter for an IP address.
 * Resets the window if it has expired.
 *
 * @param {string} ipAddress - The IP address to track
 * @returns {Promise<object>} The updated rate limit record
 */
export async function incrementIpRequestCount(ipAddress) {
  const windowMs = getWindowMs()
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

  const windowEnd = existing.windowStart.getTime() + windowMs

  // Window expired — reset counter
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
  const maxRequests = getIpMaxRequests()

  // Auto-block when limit is reached
  if (newCount >= maxRequests) {
    const blockDuration = getBlockDurationMs()
    return prisma.rateLimit.update({
      where: { id: existing.id },
      data: {
        requestCount: newCount,
        blockedUntil: new Date(Date.now() + blockDuration),
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

  const windowMs = getWindowMs()
  const windowStart = record.windowStart.getTime()
  const windowEnd = windowStart + windowMs

  // If window has expired, the counter will be reset on next increment — allow request
  if (now.getTime() >= windowEnd) {
    return
  }

  // Check if request count exceeds limit within active window
  const maxRequests = getWalletMaxRequests()
  if (record.requestCount >= maxRequests) {
    throw new RateLimitError('Too many requests. Please try again later.')
  }
}

/**
 * Increments the request counter for a wallet address.
 * Resets the window if it has expired.
 *
 * @param {string} walletAddress - The wallet address to track
 * @returns {Promise<object>} The updated rate limit record
 */
export async function incrementWalletRequestCount(walletAddress) {
  const windowMs = getWindowMs()
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

  const windowEnd = existing.windowStart.getTime() + windowMs

  // Window expired — reset counter
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
  const maxRequests = getWalletMaxRequests()

  // Auto-block when limit is reached
  if (newCount >= maxRequests) {
    const blockDuration = getBlockDurationMs()
    return prisma.rateLimit.update({
      where: { id: existing.id },
      data: {
        requestCount: newCount,
        blockedUntil: new Date(Date.now() + blockDuration),
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
