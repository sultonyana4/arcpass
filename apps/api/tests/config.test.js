import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('config module', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.PORT
    delete process.env.LOG_LEVEL
  })

  it('PORT defaults to 4000 when env var is unset', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config.port).toBe(4000)
  })

  it('LOG_LEVEL defaults to "info" when env var is unset', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config.logLevel).toBe('info')
  })

  it('config object has port and logLevel keys', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config).toHaveProperty('port')
    expect(config).toHaveProperty('logLevel')
  })

  it('config object is frozen (immutable)', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('does not throw when .env file is missing', async () => {
    await expect(import('../src/lib/config.js')).resolves.not.toThrow()
  })
})
