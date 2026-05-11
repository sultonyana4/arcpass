import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import contentTypeCheckPlugin from '../src/plugins/content-type-check.js'

describe('Content-Type Check Plugin', () => {
  let app

  beforeEach(async () => {
    app = Fastify({ logger: false })
    app.register(contentTypeCheckPlugin)
    app.post('/test', async (request) => {
      return { success: true, body: request.body }
    })
    app.get('/test', async () => {
      return { success: true }
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('rejects POST requests without application/json Content-Type', () => {
    it('rejects POST with no Content-Type header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: 'hello',
        headers: {},
      })

      expect(response.statusCode).toBe(400)
      const body = response.json()
      expect(body.error).toBe('Content-Type must be application/json')
      expect(body.statusCode).toBe(400)
    })

    it('rejects POST with text/plain Content-Type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: 'hello',
        headers: { 'content-type': 'text/plain' },
      })

      expect(response.statusCode).toBe(400)
      const body = response.json()
      expect(body.error).toBe('Content-Type must be application/json')
      expect(body.statusCode).toBe(400)
    })

    it('rejects POST with multipart/form-data Content-Type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: 'data',
        headers: { 'content-type': 'multipart/form-data' },
      })

      expect(response.statusCode).toBe(400)
      const body = response.json()
      expect(body.error).toBe('Content-Type must be application/json')
      expect(body.statusCode).toBe(400)
    })

    it('rejects POST with application/xml Content-Type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: '<xml/>',
        headers: { 'content-type': 'application/xml' },
      })

      expect(response.statusCode).toBe(400)
      const body = response.json()
      expect(body.error).toBe('Content-Type must be application/json')
      expect(body.statusCode).toBe(400)
    })
  })

  describe('allows POST requests with application/json Content-Type', () => {
    it('allows POST with application/json', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: JSON.stringify({ key: 'value' }),
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.success).toBe(true)
    })

    it('allows POST with application/json; charset=utf-8', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: JSON.stringify({ key: 'value' }),
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.success).toBe(true)
    })
  })

  describe('does not affect non-POST methods', () => {
    it('allows GET requests without Content-Type check', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.success).toBe(true)
    })

    it('allows GET requests with any Content-Type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'content-type': 'text/plain' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.success).toBe(true)
    })
  })

  describe('response shape', () => {
    it('returns exactly two fields: error and statusCode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: 'hello',
        headers: { 'content-type': 'text/plain' },
      })

      const body = response.json()
      const keys = Object.keys(body)
      expect(keys).toHaveLength(2)
      expect(keys).toContain('error')
      expect(keys).toContain('statusCode')
    })
  })
})
