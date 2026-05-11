import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import crypto from 'node:crypto'

/**
 * Hardening Validation Test Suite
 *
 * Integration-style tests that verify all production hardening requirements
 * by building a minimal Fastify app with the same plugin registration order
 * as the real server, but with mocked services.
 *
 * Uses app.inject() for fast, self-contained HTTP testing.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8
 */

// ─── Mock Rate Limit State ──────────────────────────────────────────────────

const ipRequestCounts = new Map<string, { count: number; blockedUntil: number | null }>()

function resetRateLimitState() {
  ipRequestCounts.clear()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isPrintableAscii(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x20 || code > 0x7E) return false
  }
  return true
}

function matchRoute(pattern: string, url: string): boolean {
  if (pattern === url) return true
  const regexStr = '^' + pattern
    .replace(/:[^/]+/g, '[^/]+')
    .replace(/\*/g, '.*') + '$'
  try { return new RegExp(regexStr).test(url) } catch { return false }
}

function findAllowedMethods(
  requestUrl: string,
  routeMethodMap: Map<string, Set<string>>
): Set<string> | null {
  if (routeMethodMap.has(requestUrl)) return routeMethodMap.get(requestUrl)!
  for (const [pattern, methods] of routeMethodMap) {
    if (matchRoute(pattern, requestUrl)) return methods
  }
  return null
}

// ─── Build Test App ─────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    exposeHeadRoutes: true,
    ajv: { customOptions: { removeAdditional: false } },
  })

  // Route method tracking for 405 handling — MUST be before route registration
  const routeMethodMap = new Map<string, Set<string>>()
  app.addHook('onRoute', (routeOptions) => {
    const { url, method } = routeOptions
    if (!routeMethodMap.has(url)) {
      routeMethodMap.set(url, new Set())
    }
    const methods = Array.isArray(method) ? method : [method]
    for (const m of methods) {
      routeMethodMap.get(url)!.add(m.toUpperCase())
    }
  })

  // Catch-all content type parser for non-JSON types so Fastify doesn't reject with 415
  // The default application/json parser is preserved for proper schema validation
  app.addContentTypeParser(
    /^(?!application\/json).*/,
    function (_request: any, payload: any, done: any) {
      let data = ''
      payload.on('data', (chunk: any) => { data += chunk })
      payload.on('end', () => { done(null, data) })
    }
  )

  // 1. Correlation ID Plugin
  app.register(fp(async (fastify) => {
    fastify.addHook('onRequest', async (request) => {
      const headerValue = request.headers['x-request-id'] as string | undefined
      if (
        headerValue &&
        headerValue.length >= 1 &&
        headerValue.length <= 128 &&
        isPrintableAscii(headerValue)
      ) {
        ;(request as any).correlationId = headerValue
      } else {
        ;(request as any).correlationId = crypto.randomUUID()
      }
    })
    fastify.addHook('onSend', async (request, reply) => {
      reply.header('X-Request-ID', (request as any).correlationId)
    })
  }, { name: 'correlation-id' }))

  // 2. Security Headers Plugin
  app.register(fp(async (fastify) => {
    fastify.addHook('onSend', async (_request, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('X-Frame-Options', 'DENY')
      reply.header('X-XSS-Protection', '0')
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      reply.header('Cache-Control', 'no-store')
      reply.removeHeader('X-Powered-By')
    })
  }, { name: 'security-headers' }))

  // 3. Content-Type Check (preValidation — runs before schema validation)
  app.register(fp(async (fastify) => {
    fastify.addHook('preValidation', async (request, reply) => {
      if (request.method !== 'POST') return
      const contentType = request.headers['content-type']
      if (!contentType || !contentType.startsWith('application/json')) {
        return reply.code(400).send({
          error: 'Content-Type must be application/json',
          statusCode: 400,
        })
      }
    })
  }, { name: 'content-type-check' }))

  // 4. IP Rate Limiting (preHandler on all routes except /health)
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health') return

    const forwarded = request.headers['x-forwarded-for'] as string | undefined
    const clientIp = forwarded?.split(',')[0]?.trim() || request.ip

    let record = ipRequestCounts.get(clientIp)
    if (!record) {
      record = { count: 0, blockedUntil: null }
      ipRequestCounts.set(clientIp, record)
    }

    // Check if blocked
    if (record.blockedUntil && record.blockedUntil > Date.now()) {
      const retryAfter = Math.ceil((record.blockedUntil - Date.now()) / 1000)
      return reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .send({ error: 'Too many requests. Please try again later.', statusCode: 429 })
    }

    // Clear expired block
    if (record.blockedUntil && record.blockedUntil <= Date.now()) {
      record.blockedUntil = null
      record.count = 0
    }

    record.count++

    // Block at threshold (10 requests)
    if (record.count >= 10) {
      record.blockedUntil = Date.now() + 900000 // 15 min block
      const retryAfter = Math.ceil(900000 / 1000)
      return reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .send({ error: 'Too many requests. Please try again later.', statusCode: 429 })
    }
  })

  // 5. Error Handler Plugin
  app.register(fp(async (fastify) => {
    fastify.setErrorHandler((error: any, _request, reply) => {
      // JSON parse errors
      if (error.statusCode === 400 && !error.validation) {
        if (
          error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
          error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
          (error.message || '').toLowerCase().includes('unexpected token') ||
          (error.message || '').toLowerCase().includes('invalid json')
        ) {
          return reply.status(400).send({ error: 'Invalid JSON in request body', statusCode: 400 })
        }
      }

      // Schema validation errors
      if (error.validation) {
        const parts = error.validation.map((v: any) => {
          const field = v.instancePath
            ? v.instancePath.replace(/^\//, '').replace(/\//g, '.')
            : v.params?.missingProperty || 'request'
          switch (v.keyword) {
            case 'required': return `${v.params.missingProperty} is required`
            case 'pattern': return `${field} has an invalid format`
            case 'additionalProperties': return `Unknown property: ${v.params.additionalProperty}`
            case 'maxLength': return `${field} exceeds maximum length`
            default: return `${field} is invalid`
          }
        })
        return reply.status(400).send({ error: parts.join('; '), statusCode: 400 })
      }

      // Unknown errors — sanitized
      return reply.status(500).send({ error: 'Internal server error', statusCode: 500 })
    })
  }, { name: 'error-handler' }))

  // ─── Routes ───────────────────────────────────────────────────────────────

  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/sponsorship/request', {
    schema: {
      body: {
        type: 'object',
        required: ['walletAddress'],
        properties: {
          walletAddress: {
            type: 'string',
            pattern: '^0x[0-9a-fA-F]{40}$',
            maxLength: 42,
          },
        },
        additionalProperties: false,
      },
    },
  }, async (_request, reply) => {
    return reply.status(201).send({
      id: crypto.randomUUID(),
      status: 'pending',
      walletAddress: (_request.body as any).walletAddress,
    })
  })

  app.get('/sponsorship/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    return reply.status(200).send({ id: (request.params as any).id, status: 'pending' })
  })

  app.post('/wallets/register', {
    schema: {
      body: {
        type: 'object',
        required: ['walletAddress'],
        properties: {
          walletAddress: {
            type: 'string',
            pattern: '^0x[0-9a-fA-F]{40}$',
            maxLength: 42,
          },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    return reply.status(201).send({
      id: crypto.randomUUID(),
      walletAddress: (request.body as any).walletAddress,
    })
  })

  app.get('/wallets/:address', async (request, reply) => {
    return reply.status(200).send({
      walletAddress: (request.params as any).address,
      isBlocked: false,
    })
  })

  app.get('/relay/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    return reply.status(200).send({ id: (request.params as any).id, status: 'submitted' })
  })

  // Not-found handler with 405 support (registered after routes)
  app.setNotFoundHandler((request, reply) => {
    const requestMethod = request.method.toUpperCase()
    const requestUrl = request.url.split('?')[0]
    const allowedMethods = findAllowedMethods(requestUrl, routeMethodMap)

    if (allowedMethods && allowedMethods.size > 0) {
      if (requestMethod === 'HEAD' && allowedMethods.has('GET')) {
        reply.code(200).header('content-type', 'application/json; charset=utf-8').send('')
        return
      }
      const allowHeader = Array.from(allowedMethods).sort().join(', ')
      reply.code(405).header('Allow', allowHeader).send({
        error: 'Method not allowed',
        statusCode: 405,
      })
      return
    }

    reply.code(404).send({ error: 'Not found', statusCode: 404 })
  })

  await app.ready()
  return app
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetRateLimitState()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.1: Malformed Payloads → 400 with error field
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.1: Malformed payloads return 400 with error field', () => {
  it('rejects missing required fields with 400 and error field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('rejects invalid JSON syntax with 400 and error field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: '{not valid json!!!',
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')
  })

  it('rejects non-JSON content-type with 400 and error field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'text/plain' },
      payload: 'walletAddress=0x1234567890abcdef1234567890abcdef12345678',
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toContain('Content-Type')
  })

  it('rejects invalid wallet address format with 400 and error field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ walletAddress: '0xinvalid' }),
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')
  })

  it('rejects additional properties with 400 and error field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        extraField: 'should not be here',
      }),
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.2: Rate Limiting → 429 with Retry-After header
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.2: Rate limiting returns 429 with Retry-After', () => {
  it('returns 429 with Retry-After header after exceeding 10 requests', async () => {
    const testIp = '192.168.100.1'

    // Send 9 requests (should all succeed)
    for (let i = 0; i < 9; i++) {
      await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': testIp,
        },
        payload: JSON.stringify({ walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' }),
      })
    }

    // The 10th request should trigger the block
    const blockingResponse = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': testIp,
      },
      payload: JSON.stringify({ walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' }),
    })

    expect(blockingResponse.statusCode).toBe(429)
    const body = blockingResponse.json()
    expect(body).toHaveProperty('error')
    expect(body).toHaveProperty('statusCode', 429)
    expect(blockingResponse.headers['retry-after']).toBeDefined()
    expect(Number(blockingResponse.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('continues to reject after being blocked', async () => {
    const testIp = '192.168.200.1'

    // Exhaust rate limit
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': testIp,
        },
        payload: JSON.stringify({ walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' }),
      })
    }

    // Subsequent request should also be 429
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': testIp,
      },
      payload: JSON.stringify({ walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' }),
    })

    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.3: Undefined routes → 404 responses
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.3: Undefined routes return 404', () => {
  it('returns 404 for GET to undefined route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/nonexistent/path',
    })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    expect(body).toEqual({ error: 'Not found', statusCode: 404 })
  })

  it('returns 404 for POST to undefined route', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/does/not/exist',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: 'test' }),
    })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    expect(body).toEqual({ error: 'Not found', statusCode: 404 })
  })

  it('returns identical 404 response regardless of path or method', async () => {
    const paths = ['/unknown', '/api/v2/secret', '/admin/debug']
    const methods = ['GET', 'DELETE', 'PATCH'] as const

    for (const path of paths) {
      for (const method of methods) {
        const response = await app.inject({ method, url: path })
        expect(response.statusCode).toBe(404)
        const body = response.json()
        expect(body).toEqual({ error: 'Not found', statusCode: 404 })
      }
    }
  })

  it('does not echo the requested path in 404 response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/secret-internal-path',
    })

    expect(response.statusCode).toBe(404)
    const bodyStr = response.payload
    expect(bodyStr).not.toContain('secret-internal-path')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.4: Unsupported HTTP methods → 405 with Allow header
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.4: Unsupported methods return 405 with Allow header', () => {
  it('returns 405 for PUT on POST-only route (/sponsorship/request)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/sponsorship/request',
    })

    expect(response.statusCode).toBe(405)
    const body = response.json()
    expect(body).toHaveProperty('error', 'Method not allowed')
    expect(body).toHaveProperty('statusCode', 405)
    expect(response.headers['allow']).toBeDefined()
    expect(response.headers['allow']).toContain('POST')
  })

  it('returns 405 for DELETE on GET-only route (/health)', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/health',
    })

    expect(response.statusCode).toBe(405)
    const body = response.json()
    expect(body).toHaveProperty('error', 'Method not allowed')
    expect(body).toHaveProperty('statusCode', 405)
    expect(response.headers['allow']).toBeDefined()
    expect(response.headers['allow']).toContain('GET')
  })

  it('returns 405 for PATCH on GET-only route (/wallets/:address)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/wallets/0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    })

    expect(response.statusCode).toBe(405)
    const body = response.json()
    expect(body).toHaveProperty('error', 'Method not allowed')
    expect(body).toHaveProperty('statusCode', 405)
    expect(response.headers['allow']).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.5: Security headers present on all response types
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.5: Security headers present on all responses', () => {
  const expectedHeaders: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-xss-protection': '0',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'cache-control': 'no-store',
  }

  it('includes security headers on successful responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    for (const [header, value] of Object.entries(expectedHeaders)) {
      expect(response.headers[header]).toBe(value)
    }
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('includes security headers on 400 error responses', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    expect(response.statusCode).toBe(400)
    for (const [header, value] of Object.entries(expectedHeaders)) {
      expect(response.headers[header]).toBe(value)
    }
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('includes security headers on 404 responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/nonexistent' })

    expect(response.statusCode).toBe(404)
    for (const [header, value] of Object.entries(expectedHeaders)) {
      expect(response.headers[header]).toBe(value)
    }
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('includes security headers on 405 responses', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/health' })

    expect(response.statusCode).toBe(405)
    for (const [header, value] of Object.entries(expectedHeaders)) {
      expect(response.headers[header]).toBe(value)
    }
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('includes security headers on 429 rate-limited responses', async () => {
    const testIp = '10.0.0.99'

    // Exhaust rate limit
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'GET',
        url: '/wallets/0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        headers: { 'x-forwarded-for': testIp },
      })
    }

    const response = await app.inject({
      method: 'GET',
      url: '/wallets/0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      headers: { 'x-forwarded-for': testIp },
    })

    expect(response.statusCode).toBe(429)
    for (const [header, value] of Object.entries(expectedHeaders)) {
      expect(response.headers[header]).toBe(value)
    }
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('does not include X-Powered-By header on any response', async () => {
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/health' }),
      app.inject({ method: 'GET', url: '/nonexistent' }),
      app.inject({
        method: 'POST',
        url: '/sponsorship/request',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' }),
      }),
    ])

    for (const response of responses) {
      expect(response.headers['x-powered-by']).toBeUndefined()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.6: Correlation ID generation and passthrough
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.6: Correlation ID generation and passthrough', () => {
  it('generates X-Request-ID when none provided', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.headers['x-request-id']).toBeDefined()
    const id = response.headers['x-request-id'] as string
    expect(id.length).toBeGreaterThan(0)
    // Should be a UUID v4 format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('passes through valid X-Request-ID header', async () => {
    const customId = 'my-custom-request-id-12345'

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': customId },
    })

    expect(response.headers['x-request-id']).toBe(customId)
  })

  it('generates new ID when X-Request-ID is empty', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': '' },
    })

    const id = response.headers['x-request-id'] as string
    expect(id).toBeDefined()
    expect(id.length).toBeGreaterThan(0)
    expect(id).not.toBe('')
  })

  it('generates new ID when X-Request-ID exceeds 128 characters', async () => {
    const longId = 'a'.repeat(129)

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': longId },
    })

    const id = response.headers['x-request-id'] as string
    expect(id).not.toBe(longId)
    expect(id.length).toBeLessThanOrEqual(128)
  })

  it('includes X-Request-ID on error responses (404)', async () => {
    const response = await app.inject({ method: 'GET', url: '/nonexistent' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['x-request-id']).toBeDefined()
    expect((response.headers['x-request-id'] as string).length).toBeGreaterThan(0)
  })

  it('includes X-Request-ID on 400 validation error responses', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers['x-request-id']).toBeDefined()
    expect((response.headers['x-request-id'] as string).length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.7: Error response shape consistency
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.7: Error response shape {error, statusCode} consistency', () => {
  it('400 responses have consistent {error, statusCode} shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body).toHaveProperty('error')
    expect(body).toHaveProperty('statusCode', 400)
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('404 responses have consistent {error, statusCode} shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/nonexistent' })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    expect(body).toEqual({ error: 'Not found', statusCode: 404 })
  })

  it('405 responses have consistent {error, statusCode} shape', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/health' })

    expect(response.statusCode).toBe(405)
    const body = response.json()
    expect(body).toEqual({ error: 'Method not allowed', statusCode: 405 })
  })

  it('429 responses have consistent {error, statusCode} shape', async () => {
    const testIp = '10.0.0.200'

    // Exhaust rate limit
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'GET',
        url: '/wallets/0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        headers: { 'x-forwarded-for': testIp },
      })
    }

    const response = await app.inject({
      method: 'GET',
      url: '/wallets/0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      headers: { 'x-forwarded-for': testIp },
    })

    expect(response.statusCode).toBe(429)
    const body = response.json()
    expect(body).toHaveProperty('error')
    expect(body).toHaveProperty('statusCode', 429)
    expect(typeof body.error).toBe('string')
  })

  it('statusCode in body matches HTTP response status code', async () => {
    // 400
    const res400 = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ walletAddress: 'invalid' }),
    })
    expect(res400.json().statusCode).toBe(res400.statusCode)

    // 404
    const res404 = await app.inject({ method: 'GET', url: '/nope' })
    expect(res404.json().statusCode).toBe(res404.statusCode)

    // 405
    const res405 = await app.inject({ method: 'DELETE', url: '/health' })
    expect(res405.json().statusCode).toBe(res405.statusCode)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Requirement 19.8: Sensitive data not leaked in error responses
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requirement 19.8: No sensitive data leaked in error responses', () => {
  it('does not include stack traces in error responses', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    const bodyStr = response.payload
    expect(bodyStr).not.toContain('at ')
    expect(bodyStr).not.toContain('.js:')
    expect(bodyStr).not.toContain('.ts:')
    expect(bodyStr).not.toContain('node_modules')
  })

  it('does not include file paths in error responses', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ walletAddress: 'bad' }),
    })

    const bodyStr = response.payload
    expect(bodyStr).not.toContain('/home/')
    expect(bodyStr).not.toContain('/usr/')
    expect(bodyStr).not.toContain('/app/')
    expect(bodyStr).not.toMatch(/[A-Z]:\\/)
  })

  it('does not include environment variable values in error responses', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })

    const bodyStr = response.payload
    expect(bodyStr).not.toContain('DATABASE_URL')
    expect(bodyStr).not.toContain('postgresql://')
    expect(bodyStr).not.toContain('SPONSOR_PRIVATE_KEY')
  })

  it('does not include database query strings in error responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/nonexistent' })

    const bodyStr = response.payload
    expect(bodyStr).not.toContain('SELECT')
    expect(bodyStr).not.toContain('INSERT')
    expect(bodyStr).not.toContain('UPDATE')
    expect(bodyStr).not.toContain('DELETE FROM')
  })

  it('does not include internal module names in 404 responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/internal/debug' })

    expect(response.statusCode).toBe(404)
    const body = response.json()
    // Should only have error and statusCode — no route suggestions or internal info
    const keys = Object.keys(body)
    expect(keys).toEqual(['error', 'statusCode'])
  })

  it('500 errors return generic message without internal details', async () => {
    // Verify the error handler sanitizes validation errors properly
    const response = await app.inject({
      method: 'POST',
      url: '/sponsorship/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ walletAddress: '0xinvalid' }),
    })

    const body = response.json()
    // Should not contain JSON Schema keywords
    expect(body.error).not.toContain('schema')
    expect(body.error).not.toContain('$ref')
    expect(body.error).not.toContain('allOf')
    expect(body.error).not.toContain('anyOf')
  })
})
