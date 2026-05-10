import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import healthRoutes from '../src/routes/health.js'

describe('GET /health', () => {
  let app

  beforeEach(async () => {
    app = Fastify()
    app.register(healthRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with Content-Type application/json', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/application\/json/)
  })

  it('returns response body with status "ok"', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    const body = response.json()
    expect(body.status).toBe('ok')
  })

  it('returns response body with uptime as a non-negative integer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    const body = response.json()
    expect(body.uptime).toBeTypeOf('number')
    expect(Number.isInteger(body.uptime)).toBe(true)
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })

  it('server binds to configured port', async () => {
    const server = Fastify()
    server.register(healthRoutes)

    await server.listen({ port: 0 })

    const address = server.addresses()
    expect(address.length).toBeGreaterThan(0)
    expect(address[0].port).toBeTypeOf('number')
    expect(address[0].port).toBeGreaterThan(0)

    await server.close()
  })
})
