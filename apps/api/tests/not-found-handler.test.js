import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'

/**
 * Unit tests for the Not Found Handler plugin.
 *
 * Tests cover:
 * - 404 response for undefined routes
 * - 404 response is identical regardless of HTTP method or path
 * - 404 response contains no path echo, route suggestions, or internal identifiers
 * - 405 response for known routes with unsupported methods
 * - 405 response includes Allow header with supported methods
 * - HEAD on GET routes responds with same status/headers but empty body
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 18.1, 18.2, 18.3
 */

// Helper to build a Fastify app with the not-found-handler plugin and test routes
async function buildApp() {
  vi.doMock('../src/lib/config.js', () => ({
    config: Object.freeze({
      corsAllowedOrigins: [],
      port: 4000,
      logLevel: 'info',
      databaseUrl: 'postgresql://localhost/test',
      nodeEnv: 'test',
      isProduction: false,
      rateLimitIpMax: 10,
      rateLimitWindowMs: 3600000,
      rateLimitBlockDurationMs: 900000,
      rateLimitWalletMax: 5,
    }),
  }))

  const { default: notFoundHandlerPlugin } = await import('../src/plugins/not-found-handler.js')

  const app = Fastify({ logger: false })
  await app.register(notFoundHandlerPlugin)

  // Register test routes to simulate a real API
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/items/:id', async (request) => ({ id: request.params.id }))
  app.post('/items', async () => ({ created: true }))
  app.get('/items/:id/details', async (request) => ({ id: request.params.id, details: true }))

  await app.ready()
  return app
}

describe('Not Found Handler Plugin', () => {
  afterEach(() => {
    vi.resetModules()
  })

  describe('404 - Route not found', () => {
    it('should return 404 with standard body for undefined GET route', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent',
      })

      expect(response.statusCode).toBe(404)
      const body = response.json()
      expect(body).toEqual({ error: 'Not found', statusCode: 404 })
    })

    it('should return 404 with standard body for undefined POST route', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/nonexistent',
      })

      expect(response.statusCode).toBe(404)
      const body = response.json()
      expect(body).toEqual({ error: 'Not found', statusCode: 404 })
    })

    it('should return 404 with standard body for undefined PUT route', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'PUT',
        url: '/nonexistent',
      })

      expect(response.statusCode).toBe(404)
      const body = response.json()
      expect(body).toEqual({ error: 'Not found', statusCode: 404 })
    })

    it('should return 404 with standard body for undefined DELETE route', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'DELETE',
        url: '/nonexistent/path/deep',
      })

      expect(response.statusCode).toBe(404)
      const body = response.json()
      expect(body).toEqual({ error: 'Not found', statusCode: 404 })
    })

    it('should return identical 404 response regardless of path', async () => {
      const app = await buildApp()

      const paths = ['/foo', '/bar/baz', '/a/b/c/d', '/../etc/passwd', '/admin']
      const responses = await Promise.all(
        paths.map((url) => app.inject({ method: 'GET', url }))
      )

      for (const response of responses) {
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({ error: 'Not found', statusCode: 404 })
      }
    })

    it('should return identical 404 response regardless of HTTP method', async () => {
      const app = await buildApp()

      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
      const responses = await Promise.all(
        methods.map((method) => app.inject({ method, url: '/unknown-route' }))
      )

      for (const response of responses) {
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({ error: 'Not found', statusCode: 404 })
      }
    })

    it('should not include path echo in 404 response', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'GET',
        url: '/secret/internal/path',
      })

      const body = response.json()
      expect(body).toEqual({ error: 'Not found', statusCode: 404 })
      expect(JSON.stringify(body)).not.toContain('/secret/internal/path')
    })

    it('should not include route suggestions in 404 response', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'GET',
        url: '/healt', // Close to /health
      })

      const body = response.json()
      expect(body).toEqual({ error: 'Not found', statusCode: 404 })
      expect(JSON.stringify(body)).not.toContain('health')
      expect(JSON.stringify(body)).not.toContain('suggestion')
    })

    it('should not include internal identifiers in 404 response', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent',
      })

      const body = response.json()
      // Only exactly two fields
      expect(Object.keys(body)).toHaveLength(2)
      expect(Object.keys(body).sort()).toEqual(['error', 'statusCode'])
    })

    it('should return application/json content-type for 404', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent',
      })

      expect(response.headers['content-type']).toContain('application/json')
    })
  })

  describe('405 - Method not allowed', () => {
    it('should return 405 when using POST on a GET-only route', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/health',
      })

      expect(response.statusCode).toBe(405)
      const body = response.json()
      expect(body).toEqual({ error: 'Method not allowed', statusCode: 405 })
    })

    it('should include Allow header with supported methods', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'DELETE',
        url: '/health',
      })

      expect(response.statusCode).toBe(405)
      expect(response.headers['allow']).toBeDefined()
      expect(response.headers['allow']).toContain('GET')
    })

    it('should return 405 when using DELETE on a route that supports GET and POST', async () => {
      const app = await buildApp()

      // /items supports POST, /items/:id supports GET
      const response = await app.inject({
        method: 'DELETE',
        url: '/items',
      })

      expect(response.statusCode).toBe(405)
      const body = response.json()
      expect(body).toEqual({ error: 'Method not allowed', statusCode: 405 })
      expect(response.headers['allow']).toContain('POST')
    })

    it('should return 405 when using PUT on a parameterized GET route', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'PUT',
        url: '/items/123',
      })

      expect(response.statusCode).toBe(405)
      const body = response.json()
      expect(body).toEqual({ error: 'Method not allowed', statusCode: 405 })
      expect(response.headers['allow']).toContain('GET')
    })

    it('should return 405 instead of 404 for known route with wrong method', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'PATCH',
        url: '/health',
      })

      // Must be 405, not 404
      expect(response.statusCode).toBe(405)
    })
  })

  describe('HEAD on GET routes', () => {
    it('should respond to HEAD on GET route with 200 and empty body', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'HEAD',
        url: '/health',
      })

      expect(response.statusCode).toBe(200)
      expect(response.body).toBe('')
    })

    it('should include content-type header on HEAD response', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'HEAD',
        url: '/health',
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('application/json')
    })

    it('should respond to HEAD on parameterized GET route with 200 and empty body', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'HEAD',
        url: '/items/abc-123',
      })

      expect(response.statusCode).toBe(200)
      expect(response.body).toBe('')
    })

    it('should return 404 for HEAD on undefined route', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'HEAD',
        url: '/nonexistent',
      })

      expect(response.statusCode).toBe(404)
    })
  })
})
