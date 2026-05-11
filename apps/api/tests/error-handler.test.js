import { describe, it, expect, afterEach } from 'vitest'
import Fastify from 'fastify'
import errorHandlerPlugin from '../src/plugins/error-handler.js'
import {
  ValidationError,
  BlockedWalletError,
  WalletNotFoundError,
  SponsorshipNotFoundError,
  RateLimitError,
  InvalidStatusTransitionError,
} from '../src/lib/errors.js'

/**
 * Creates a Fastify instance with the error handler plugin registered.
 * Passes isProduction option to avoid loading config (which requires DATABASE_URL).
 */
function buildApp(opts = {}) {
  const app = Fastify({ logger: false })
  app.register(errorHandlerPlugin, { isProduction: false, ...opts })
  return app
}

describe('Error Handler Plugin', () => {
  let app

  afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  describe('JSON parse errors → 400', () => {
    it('returns 400 with "Invalid JSON in request body" for malformed JSON', async () => {
      app = buildApp()
      app.post('/test', async () => ({ ok: true }))
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'content-type': 'application/json' },
        payload: '{ invalid json }',
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBe('Invalid JSON in request body')
      expect(body.statusCode).toBe(400)
    })

    it('returns 400 for truncated JSON', async () => {
      app = buildApp()
      app.post('/test', async () => ({ ok: true }))
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'content-type': 'application/json' },
        payload: '{"name": "test"',
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBe('Invalid JSON in request body')
      expect(body.statusCode).toBe(400)
    })
  })

  describe('Schema validation errors → 400', () => {
    it('returns 400 with field-level description for missing required field', async () => {
      app = buildApp()
      app.post('/test', {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      }, async () => ({ ok: true }))
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: {},
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.statusCode).toBe(400)
      expect(body.error).toContain('name')
      expect(body.error).toContain('required')
      // Should not expose raw JSON Schema keywords
      expect(body.error).not.toContain('$ref')
    })

    it('returns 400 with field-level description for type mismatch', async () => {
      app = buildApp()
      app.post('/test', {
        schema: {
          body: {
            type: 'object',
            properties: { age: { type: 'number' } },
          },
        },
      }, async () => ({ ok: true }))
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: { age: 'not-a-number' },
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.statusCode).toBe(400)
      expect(body.error).toContain('age')
      expect(body.error).toContain('number')
    })

    it('returns 400 for additional properties when not allowed', async () => {
      app = Fastify({
        logger: false,
        ajv: { customOptions: { removeAdditional: false } },
      })
      app.register(errorHandlerPlugin, { isProduction: false })
      app.post('/test', {
        schema: {
          body: {
            type: 'object',
            properties: { name: { type: 'string' } },
            additionalProperties: false,
          },
        },
      }, async () => ({ ok: true }))
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: { name: 'test', extra: 'field' },
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.statusCode).toBe(400)
      expect(body.error).toContain('extra')
    })

    it('returns 400 for pattern mismatch without exposing the regex', async () => {
      app = buildApp()
      app.post('/test', {
        schema: {
          body: {
            type: 'object',
            properties: {
              walletAddress: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
            },
          },
        },
      }, async () => ({ ok: true }))
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: { walletAddress: 'invalid' },
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.statusCode).toBe(400)
      expect(body.error).toContain('invalid format')
      // Should not expose the raw regex pattern
      expect(body.error).not.toContain('^0x')
      expect(body.error).not.toContain('[0-9a-fA-F]')
    })
  })

  describe('ValidationError → 400', () => {
    it('returns 400 with the error message', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new ValidationError('Invalid wallet address format')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBe('Invalid wallet address format')
      expect(body.statusCode).toBe(400)
    })
  })

  describe('BlockedWalletError → 403', () => {
    it('returns 403 with the error message', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new BlockedWalletError('Wallet is blocked')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(403)
      const body = res.json()
      expect(body.error).toBe('Wallet is blocked')
      expect(body.statusCode).toBe(403)
    })
  })

  describe('WalletNotFoundError → 404', () => {
    it('returns 404 with the error message', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new WalletNotFoundError('Wallet not found')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error).toBe('Wallet not found')
      expect(body.statusCode).toBe(404)
    })
  })

  describe('SponsorshipNotFoundError → 404', () => {
    it('returns 404 with the error message', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new SponsorshipNotFoundError('Sponsorship request not found')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error).toBe('Sponsorship request not found')
      expect(body.statusCode).toBe(404)
    })
  })

  describe('RateLimitError → 429', () => {
    it('returns 429 with the error message and Retry-After header', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new RateLimitError('Too many requests', { retryAfter: 60 })
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(429)
      const body = res.json()
      expect(body.error).toBe('Too many requests')
      expect(body.statusCode).toBe(429)
      expect(res.headers['retry-after']).toBe('60')
    })

    it('returns 429 without Retry-After when not provided', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new RateLimitError('Too many requests')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(429)
      expect(res.headers['retry-after']).toBeUndefined()
    })
  })

  describe('InvalidStatusTransitionError → 400', () => {
    it('returns 400 with the error message', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new InvalidStatusTransitionError('Cannot transition from completed to pending')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBe('Cannot transition from completed to pending')
      expect(body.statusCode).toBe(400)
    })
  })

  describe('Unknown errors → 500 with sanitized message', () => {
    it('returns 500 with generic message for unexpected errors', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new Error('FATAL: relation "wallets" does not exist')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(body.error).toBe('Internal server error')
      expect(body.statusCode).toBe(500)
    })

    it('does not expose stack traces in the response', async () => {
      app = buildApp()
      app.get('/test', async () => {
        const err = new Error('connection refused')
        err.stack = 'Error: connection refused\n    at Object.<anonymous> (/app/src/server.js:10:5)'
        throw err
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      const body = res.json()
      expect(body.error).not.toContain('/app/src')
      expect(body.error).toBe('Internal server error')
      expect(JSON.stringify(body)).not.toContain('stack')
    })

    it('does not expose database details in the response', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new Error('INSERT INTO wallets (wallet_address) VALUES ($1) - column "wallet_address" violates unique constraint')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      const body = res.json()
      expect(body.error).not.toContain('INSERT')
      expect(body.error).not.toContain('wallets')
      expect(body.error).not.toContain('wallet_address')
      expect(body.error).toBe('Internal server error')
    })
  })

  describe('Response shape consistency', () => {
    it('statusCode in body always matches HTTP response status code', async () => {
      app = buildApp()
      app.get('/400', async () => { throw new ValidationError('bad input') })
      app.get('/403', async () => { throw new BlockedWalletError('blocked') })
      app.get('/404', async () => { throw new WalletNotFoundError('not found') })
      app.get('/429', async () => { throw new RateLimitError('throttled') })
      app.get('/500', async () => { throw new Error('crash') })
      await app.ready()

      const expectedCodes = { '/400': 400, '/403': 403, '/404': 404, '/429': 429, '/500': 500 }
      for (const [url, expectedStatus] of Object.entries(expectedCodes)) {
        const res = await app.inject({ method: 'GET', url })
        const body = res.json()
        expect(res.statusCode).toBe(expectedStatus)
        expect(body.statusCode).toBe(expectedStatus)
      }
    })

    it('all error responses contain only error and statusCode in production mode', async () => {
      app = buildApp({ isProduction: true })
      app.get('/validation', async () => { throw new ValidationError('bad') })
      app.get('/blocked', async () => { throw new BlockedWalletError('blocked') })
      app.get('/notfound', async () => { throw new WalletNotFoundError('missing') })
      app.get('/sponsorship-notfound', async () => { throw new SponsorshipNotFoundError('missing') })
      app.get('/ratelimit', async () => { throw new RateLimitError('throttled', { retryAfter: 30 }) })
      app.get('/unexpected', async () => { throw new Error('oops') })
      await app.ready()

      const routes = ['/validation', '/blocked', '/notfound', '/sponsorship-notfound', '/ratelimit', '/unexpected']
      for (const url of routes) {
        const res = await app.inject({ method: 'GET', url })
        const body = res.json()
        const keys = Object.keys(body).sort()
        expect(keys).toEqual(['error', 'statusCode'])
        expect(typeof body.error).toBe('string')
        expect(body.error.length).toBeGreaterThan(0)
        expect(typeof body.statusCode).toBe('number')
        expect(body.statusCode).toBe(res.statusCode)
      }
    })

    it('never includes stack traces, paths, or env values in any mode', async () => {
      app = buildApp()
      app.get('/validation', async () => { throw new ValidationError('bad') })
      app.get('/blocked', async () => { throw new BlockedWalletError('blocked') })
      app.get('/unexpected', async () => { throw new Error('oops') })
      await app.ready()

      const routes = ['/validation', '/blocked', '/unexpected']
      for (const url of routes) {
        const res = await app.inject({ method: 'GET', url })
        const body = res.json()
        const bodyStr = JSON.stringify(body)
        expect(bodyStr).not.toContain('stack')
        expect(bodyStr).not.toMatch(/at\s+\S+\s+\(/) // no stack trace patterns
      }
    })
  })

  describe('Production vs Development mode', () => {
    it('in development mode, includes errorName for known errors', async () => {
      app = buildApp({ isProduction: false })
      app.get('/test', async () => {
        throw new ValidationError('bad input')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })
      const body = res.json()

      expect(body.error).toBe('bad input')
      expect(body.statusCode).toBe(400)
      expect(body.errorName).toBe('ValidationError')
    })

    it('in production mode, does not include errorName', async () => {
      app = buildApp({ isProduction: true })
      app.get('/test', async () => {
        throw new ValidationError('bad input')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })
      const body = res.json()

      expect(body.error).toBe('bad input')
      expect(body.statusCode).toBe(400)
      expect(body).not.toHaveProperty('errorName')
    })

    it('in development mode, never includes stack traces or paths', async () => {
      app = buildApp({ isProduction: false })
      app.get('/test', async () => {
        const err = new ValidationError('bad')
        err.stack = 'ValidationError: bad\n    at /home/user/project/src/handler.js:15:3'
        throw err
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })
      const body = res.json()
      const bodyStr = JSON.stringify(body)

      expect(bodyStr).not.toContain('/home/user')
      expect(bodyStr).not.toContain('handler.js')
      expect(bodyStr).not.toContain('stack')
    })

    it('unknown errors do not include errorName in any mode', async () => {
      app = buildApp({ isProduction: false })
      app.get('/test', async () => {
        throw new Error('something broke')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })
      const body = res.json()

      expect(body.error).toBe('Internal server error')
      expect(body.statusCode).toBe(500)
      expect(body).not.toHaveProperty('errorName')
    })
  })
})
