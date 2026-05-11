import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

/**
 * Unit tests for the CORS plugin.
 *
 * Tests cover:
 * - Allowed origins get proper CORS headers
 * - Disallowed origins get no CORS headers
 * - Empty/unset CORS_ALLOWED_ORIGINS blocks all cross-origin
 * - Preflight OPTIONS returns 204 for allowed origins
 * - Preflight OPTIONS returns 204 with no CORS headers for disallowed origins
 * - Access-Control-Allow-Credentials is never sent
 * - Correct methods and headers are advertised
 */

// Helper to build a Fastify app with the CORS plugin using a given config
async function buildApp(corsAllowedOrigins = []) {
  // Mock the config module before importing the plugin
  vi.doMock('../src/lib/config.js', () => ({
    config: Object.freeze({
      corsAllowedOrigins,
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

  // Dynamically import the plugin after mocking
  const { default: corsPlugin } = await import('../src/plugins/cors.js')

  const app = Fastify({ logger: false })
  await app.register(corsPlugin)

  // Add a test route
  app.get('/test', async () => ({ ok: true }))
  app.post('/test', async () => ({ ok: true }))

  await app.ready()
  return app
}

describe('CORS Plugin', () => {
  afterEach(() => {
    vi.resetModules()
  })

  describe('when CORS_ALLOWED_ORIGINS is empty (blocks all cross-origin)', () => {
    it('should not include any Access-Control headers on GET requests', async () => {
      const app = await buildApp([])

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://evil.com' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-methods']).toBeUndefined()
      expect(response.headers['access-control-allow-headers']).toBeUndefined()
      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    })

    it('should return 204 with no CORS headers on OPTIONS preflight', async () => {
      const app = await buildApp([])

      const response = await app.inject({
        method: 'OPTIONS',
        url: '/test',
        headers: { origin: 'https://evil.com' },
      })

      expect(response.statusCode).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-methods']).toBeUndefined()
      expect(response.headers['access-control-allow-headers']).toBeUndefined()
    })
  })

  describe('when origin is NOT in the allowlist', () => {
    it('should not include any Access-Control headers', async () => {
      const app = await buildApp(['https://allowed.com'])

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://notallowed.com' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-methods']).toBeUndefined()
      expect(response.headers['access-control-allow-headers']).toBeUndefined()
      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    })

    it('should return 204 with no CORS headers on OPTIONS preflight', async () => {
      const app = await buildApp(['https://allowed.com'])

      const response = await app.inject({
        method: 'OPTIONS',
        url: '/test',
        headers: { origin: 'https://notallowed.com' },
      })

      expect(response.statusCode).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-methods']).toBeUndefined()
      expect(response.headers['access-control-allow-headers']).toBeUndefined()
    })
  })

  describe('when origin IS in the allowlist', () => {
    it('should include correct CORS headers on GET response', async () => {
      const app = await buildApp(['https://allowed.com', 'https://other.com'])

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://allowed.com' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe('https://allowed.com')
      expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS')
      expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization')
    })

    it('should include correct CORS headers on POST response', async () => {
      const app = await buildApp(['https://myapp.com'])

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        headers: {
          origin: 'https://myapp.com',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ data: 'test' }),
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe('https://myapp.com')
      expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS')
      expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization')
    })

    it('should return 204 with CORS headers on OPTIONS preflight', async () => {
      const app = await buildApp(['https://allowed.com'])

      const response = await app.inject({
        method: 'OPTIONS',
        url: '/test',
        headers: { origin: 'https://allowed.com' },
      })

      expect(response.statusCode).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBe('https://allowed.com')
      expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS')
      expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization')
    })
  })

  describe('credentials support', () => {
    it('should never send Access-Control-Allow-Credentials header', async () => {
      const app = await buildApp(['https://allowed.com'])

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://allowed.com' },
      })

      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    })

    it('should never send credentials header on preflight', async () => {
      const app = await buildApp(['https://allowed.com'])

      const response = await app.inject({
        method: 'OPTIONS',
        url: '/test',
        headers: { origin: 'https://allowed.com' },
      })

      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    })
  })

  describe('no origin header in request', () => {
    it('should not include CORS headers when no Origin header is present', async () => {
      const app = await buildApp(['https://allowed.com'])

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
      expect(response.headers['access-control-allow-methods']).toBeUndefined()
      expect(response.headers['access-control-allow-headers']).toBeUndefined()
    })
  })

  describe('multiple allowed origins', () => {
    it('should set Access-Control-Allow-Origin to the matching origin', async () => {
      const app = await buildApp(['https://first.com', 'https://second.com', 'https://third.com'])

      const response = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://second.com' },
      })

      expect(response.headers['access-control-allow-origin']).toBe('https://second.com')
    })
  })
})
