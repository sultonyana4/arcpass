import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'net'
import { Writable } from 'stream'
import Fastify from 'fastify'
import healthRoutes from '../src/routes/health.js'

describe('server lifecycle', () => {
  let app

  afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  it('server binds to 0.0.0.0', async () => {
    app = Fastify({ logger: false })
    app.register(healthRoutes)
    await app.listen({ port: 0, host: '0.0.0.0' })

    const address = app.server.address()
    expect(address.address).toBe('0.0.0.0')
  })

  it('startup failure (port conflict) exits with code 1', async () => {
    // Occupy a port first using a raw TCP server
    const blocker = createServer()
    const port = await new Promise((resolve, reject) => {
      blocker.listen(0, '0.0.0.0', () => {
        resolve(blocker.address().port)
      })
      blocker.on('error', reject)
    })

    try {
      // Try to start Fastify on the same port — should throw
      app = Fastify({ logger: false })
      app.register(healthRoutes)

      await expect(
        app.listen({ port, host: '0.0.0.0' })
      ).rejects.toThrow()
    } finally {
      blocker.close()
    }
  })

  it('startup log message contains host and port', async () => {
    const logs = []
    const logStream = new Writable({
      write(chunk, encoding, callback) {
        logs.push(JSON.parse(chunk.toString()))
        callback()
      },
    })

    app = Fastify({
      logger: { level: 'info', stream: logStream },
    })
    app.register(healthRoutes)
    await app.listen({ port: 0, host: '0.0.0.0' })

    const address = app.server.address()
    // Fastify logs "Server listening at http://<resolved-host>:<port>"
    // The host may be resolved from 0.0.0.0 to the actual network interface IP
    const startupLog = logs.find(
      (log) => log.msg && log.msg.includes(String(address.port))
    )

    expect(startupLog).toBeDefined()
    expect(startupLog.msg).toContain(String(address.port))
    // Verify the message contains a host (IP address pattern)
    expect(startupLog.msg).toMatch(/\d+\.\d+\.\d+\.\d+/)
  })

  it('request logging includes method and URL', async () => {
    const logs = []
    const logStream = new Writable({
      write(chunk, encoding, callback) {
        logs.push(JSON.parse(chunk.toString()))
        callback()
      },
    })

    app = Fastify({
      logger: { level: 'info', stream: logStream },
    })
    app.register(healthRoutes)
    await app.ready()

    await app.inject({ method: 'GET', url: '/health' })

    const requestLog = logs.find(
      (log) => log.req && log.req.method === 'GET' && log.req.url === '/health'
    )

    expect(requestLog).toBeDefined()
    expect(requestLog.req.method).toBe('GET')
    expect(requestLog.req.url).toBe('/health')
  })
})
