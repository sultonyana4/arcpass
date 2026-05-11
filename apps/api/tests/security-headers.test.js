import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import securityHeadersPlugin from '../src/plugins/security-headers.js'

describe('Security Headers Plugin', () => {
  let app

  beforeEach(async () => {
    app = Fastify()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('core security headers', () => {
    beforeEach(async () => {
      app.register(securityHeadersPlugin)
      app.get('/test', async () => ({ ok: true }))
      await app.ready()
    })

    it('sets X-Content-Type-Options: nosniff', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['x-content-type-options']).toBe('nosniff')
    })

    it('sets X-Frame-Options: DENY', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['x-frame-options']).toBe('DENY')
    })

    it('sets X-XSS-Protection: 0', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['x-xss-protection']).toBe('0')
    })

    it('sets Content-Security-Policy header', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      )
    })

    it('sets Cache-Control: no-store', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('does not include X-Powered-By header', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['x-powered-by']).toBeUndefined()
    })

    it('does not set Strict-Transport-Security on HTTP requests', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['strict-transport-security']).toBeUndefined()
    })
  })

  describe('HSTS with enableHsts option', () => {
    beforeEach(async () => {
      app.register(securityHeadersPlugin, { enableHsts: true })
      app.get('/test', async () => ({ ok: true }))
      await app.ready()
    })

    it('sets Strict-Transport-Security when enableHsts is true', async () => {
      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains'
      )
    })
  })

  describe('headers on different response types', () => {
    beforeEach(async () => {
      app.register(securityHeadersPlugin)
      app.get('/success', async () => ({ status: 'ok' }))
      app.get('/error', async () => {
        throw new Error('test error')
      })
      app.post('/post-route', async () => ({ created: true }))
      await app.ready()
    })

    it('attaches headers to successful responses', async () => {
      const response = await app.inject({ method: 'GET', url: '/success' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['x-frame-options']).toBe('DENY')
      expect(response.headers['x-xss-protection']).toBe('0')
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      )
      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('attaches headers to error responses', async () => {
      const response = await app.inject({ method: 'GET', url: '/error' })
      expect(response.statusCode).toBe(500)
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['x-frame-options']).toBe('DENY')
      expect(response.headers['x-xss-protection']).toBe('0')
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      )
      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('attaches headers to POST responses', async () => {
      const response = await app.inject({ method: 'POST', url: '/post-route' })
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['x-frame-options']).toBe('DENY')
    })

    it('attaches headers to 404 responses', async () => {
      const response = await app.inject({ method: 'GET', url: '/nonexistent' })
      expect(response.statusCode).toBe(404)
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['x-frame-options']).toBe('DENY')
      expect(response.headers['x-xss-protection']).toBe('0')
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      )
      expect(response.headers['cache-control']).toBe('no-store')
    })
  })

  describe('X-Powered-By removal', () => {
    it('removes X-Powered-By even if manually set by another plugin', async () => {
      // Simulate another plugin setting X-Powered-By
      app.addHook('onSend', async (request, reply) => {
        reply.header('X-Powered-By', 'Fastify')
      })
      app.register(securityHeadersPlugin)
      app.get('/test', async () => ({ ok: true }))
      await app.ready()

      const response = await app.inject({ method: 'GET', url: '/test' })
      expect(response.headers['x-powered-by']).toBeUndefined()
    })
  })
})
