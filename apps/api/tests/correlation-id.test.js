import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import correlationIdPlugin from '../src/plugins/correlation-id.js'

describe('Correlation ID Plugin', () => {
  let app

  beforeEach(async () => {
    app = Fastify({ logger: false })
    app.register(correlationIdPlugin)
    app.get('/test', async (request) => {
      return { correlationId: request.correlationId }
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('generates UUID v4 when no X-Request-ID header', () => {
    it('generates a UUID v4 correlation ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('includes X-Request-ID in response header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      })

      const responseId = response.headers['x-request-id']
      expect(responseId).toBeDefined()
      expect(responseId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('response header matches request.correlationId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      })

      const body = response.json()
      const responseId = response.headers['x-request-id']
      expect(responseId).toBe(body.correlationId)
    })
  })

  describe('uses valid X-Request-ID header value', () => {
    it('uses provided header when valid', async () => {
      const customId = 'my-custom-request-id-123'
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': customId },
      })

      const body = response.json()
      expect(body.correlationId).toBe(customId)
      expect(response.headers['x-request-id']).toBe(customId)
    })

    it('accepts a single character', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': 'a' },
      })

      const body = response.json()
      expect(body.correlationId).toBe('a')
    })

    it('accepts exactly 128 characters', async () => {
      const id = 'x'.repeat(128)
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': id },
      })

      const body = response.json()
      expect(body.correlationId).toBe(id)
    })

    it('accepts printable ASCII including spaces and special chars', async () => {
      const id = 'req-123 (test) [special] {chars} ~!@#$%^&*'
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': id },
      })

      const body = response.json()
      expect(body.correlationId).toBe(id)
    })
  })

  describe('generates new ID for invalid X-Request-ID header', () => {
    it('generates UUID when header is empty string', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': '' },
      })

      const body = response.json()
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID when header exceeds 128 characters', async () => {
      const longId = 'a'.repeat(129)
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': longId },
      })

      const body = response.json()
      expect(body.correlationId).not.toBe(longId)
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID when header contains non-printable characters (tab)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': 'id-with\ttab' },
      })

      const body = response.json()
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID when header contains newline', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': 'id-with\nnewline' },
      })

      const body = response.json()
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('generates UUID when header contains null byte', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-request-id': 'id-with\x00null' },
      })

      const body = response.json()
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
  })

  describe('response header on all responses', () => {
    it('includes X-Request-ID on error responses', async () => {
      const errorApp = Fastify({ logger: false })
      errorApp.register(correlationIdPlugin)
      errorApp.get('/error', async () => {
        throw new Error('test error')
      })
      await errorApp.ready()

      const response = await errorApp.inject({
        method: 'GET',
        url: '/error',
      })

      expect(response.headers['x-request-id']).toBeDefined()
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )

      await errorApp.close()
    })

    it('includes provided X-Request-ID on error responses', async () => {
      const errorApp = Fastify({ logger: false })
      errorApp.register(correlationIdPlugin)
      errorApp.get('/error', async () => {
        throw new Error('test error')
      })
      await errorApp.ready()

      const customId = 'error-trace-id-456'
      const response = await errorApp.inject({
        method: 'GET',
        url: '/error',
        headers: { 'x-request-id': customId },
      })

      expect(response.headers['x-request-id']).toBe(customId)

      await errorApp.close()
    })

    it('each request gets a unique generated ID', async () => {
      const response1 = await app.inject({ method: 'GET', url: '/test' })
      const response2 = await app.inject({ method: 'GET', url: '/test' })

      const id1 = response1.headers['x-request-id']
      const id2 = response2.headers['x-request-id']
      expect(id1).not.toBe(id2)
    })
  })
})
