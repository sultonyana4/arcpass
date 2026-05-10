import { describe, it, expect, afterEach } from 'vitest'
import Fastify from 'fastify'
import { ValidationError, BlockedWalletError, WalletNotFoundError, SponsorshipNotFoundError } from '../src/lib/errors.js'

/**
 * Creates a Fastify instance with the same error handler as server.js
 * and registers test routes that throw specific errors.
 */
function buildApp() {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({
        error: error.message,
        statusCode: 400,
      })
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

    request.log.error(error)
    return reply.status(500).send({
      error: 'Internal server error',
      statusCode: 500,
    })
  })

  return app
}

describe('Custom Error Handler', () => {
  let app

  afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  describe('Fastify schema validation errors → 400', () => {
    it('returns 400 with standard shape for schema validation failure', async () => {
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
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('statusCode', 400)
      expect(typeof body.error).toBe('string')
      expect(body.error.length).toBeGreaterThan(0)
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
      expect(body).toEqual({
        error: 'Invalid wallet address format',
        statusCode: 400,
      })
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
      expect(body).toEqual({
        error: 'Wallet is blocked',
        statusCode: 403,
      })
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
      expect(body).toEqual({
        error: 'Wallet not found',
        statusCode: 404,
      })
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
      expect(body).toEqual({
        error: 'Sponsorship request not found',
        statusCode: 404,
      })
    })
  })

  describe('Unexpected errors → 500 with sanitized message', () => {
    it('returns 500 with generic message for unexpected errors', async () => {
      app = buildApp()
      app.get('/test', async () => {
        throw new Error('FATAL: relation "wallets" does not exist')
      })
      await app.ready()

      const res = await app.inject({ method: 'GET', url: '/test' })

      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(body).toEqual({
        error: 'Internal server error',
        statusCode: 500,
      })
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
      expect(body.error).not.toContain('stack')
      expect(body.error).not.toContain('/app/src')
      expect(body.error).toBe('Internal server error')
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
    it('all error responses have exactly "error" and "statusCode" fields', async () => {
      app = buildApp()
      app.get('/validation', async () => { throw new ValidationError('bad') })
      app.get('/blocked', async () => { throw new BlockedWalletError('blocked') })
      app.get('/notfound', async () => { throw new WalletNotFoundError('missing') })
      app.get('/sponsorship-notfound', async () => { throw new SponsorshipNotFoundError('missing') })
      app.get('/unexpected', async () => { throw new Error('oops') })
      await app.ready()

      const routes = ['/validation', '/blocked', '/notfound', '/sponsorship-notfound', '/unexpected']
      for (const url of routes) {
        const res = await app.inject({ method: 'GET', url })
        const body = res.json()
        const keys = Object.keys(body).sort()
        expect(keys).toEqual(['error', 'statusCode'])
        expect(typeof body.error).toBe('string')
        expect(typeof body.statusCode).toBe('number')
        expect(body.statusCode).toBe(res.statusCode)
      }
    })
  })
})
