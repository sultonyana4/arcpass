import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('config module', () => {
  const originalEnv = process.env
  let mockExit
  let stderrOutput

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    // Set DATABASE_URL to a valid value by default so other tests don't fail on it
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test'
    delete process.env.PORT
    delete process.env.LOG_LEVEL
    delete process.env.CORS_ALLOWED_ORIGINS
    delete process.env.NODE_ENV
    delete process.env.RATE_LIMIT_IP_MAX
    delete process.env.RATE_LIMIT_WINDOW_MS
    delete process.env.RATE_LIMIT_BLOCK_DURATION_MS
    delete process.env.RATE_LIMIT_WALLET_MAX

    // Mock process.exit to prevent test runner from exiting
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    // Capture stderr output
    stderrOutput = ''
    vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
      stderrOutput += msg
      return true
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('PORT defaults to 4000 when env var is unset', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config.port).toBe(4000)
  })

  it('PORT accepts valid integer within range', async () => {
    process.env.PORT = '8080'
    const { config } = await import('../src/lib/config.js')
    expect(config.port).toBe(8080)
  })

  it('PORT rejects non-integer values', async () => {
    process.env.PORT = '3.14'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('PORT')
  })

  it('PORT rejects values outside 1-65535', async () => {
    process.env.PORT = '0'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('PORT')
  })

  it('PORT rejects values above 65535', async () => {
    process.env.PORT = '70000'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('PORT')
  })

  it('LOG_LEVEL defaults to "info" when env var is unset', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config.logLevel).toBe('info')
  })

  it('LOG_LEVEL accepts valid values', async () => {
    process.env.LOG_LEVEL = 'debug'
    const { config } = await import('../src/lib/config.js')
    expect(config.logLevel).toBe('debug')
  })

  it('LOG_LEVEL rejects invalid values', async () => {
    process.env.LOG_LEVEL = 'verbose'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('LOG_LEVEL')
  })

  it('DATABASE_URL is required', async () => {
    delete process.env.DATABASE_URL
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('DATABASE_URL')
  })

  it('DATABASE_URL must start with postgresql:// or postgres://', async () => {
    process.env.DATABASE_URL = 'mysql://localhost/db'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('DATABASE_URL')
  })

  it('DATABASE_URL accepts postgres:// prefix', async () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/test'
    const { config } = await import('../src/lib/config.js')
    expect(config.databaseUrl).toBe('postgres://localhost:5432/test')
  })

  it('CORS_ALLOWED_ORIGINS parses comma-separated list with trimming', async () => {
    process.env.CORS_ALLOWED_ORIGINS = ' http://localhost:3000 , https://app.arcpass.io , http://dev.local '
    const { config } = await import('../src/lib/config.js')
    expect(config.corsAllowedOrigins).toEqual([
      'http://localhost:3000',
      'https://app.arcpass.io',
      'http://dev.local',
    ])
  })

  it('CORS_ALLOWED_ORIGINS defaults to empty array when unset', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config.corsAllowedOrigins).toEqual([])
  })

  it('NODE_ENV defaults to development', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config.nodeEnv).toBe('development')
    expect(config.isProduction).toBe(false)
  })

  it('NODE_ENV=production sets isProduction to true', async () => {
    process.env.NODE_ENV = 'production'
    const { config } = await import('../src/lib/config.js')
    expect(config.isProduction).toBe(true)
  })

  it('rate limit config uses defaults when env vars are unset', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config.rateLimitIpMax).toBe(10)
    expect(config.rateLimitWindowMs).toBe(3600000)
    expect(config.rateLimitBlockDurationMs).toBe(900000)
    expect(config.rateLimitWalletMax).toBe(5)
  })

  it('rate limit config accepts valid values', async () => {
    process.env.RATE_LIMIT_IP_MAX = '20'
    process.env.RATE_LIMIT_WINDOW_MS = '7200000'
    process.env.RATE_LIMIT_BLOCK_DURATION_MS = '1800000'
    process.env.RATE_LIMIT_WALLET_MAX = '3'
    const { config } = await import('../src/lib/config.js')
    expect(config.rateLimitIpMax).toBe(20)
    expect(config.rateLimitWindowMs).toBe(7200000)
    expect(config.rateLimitBlockDurationMs).toBe(1800000)
    expect(config.rateLimitWalletMax).toBe(3)
  })

  it('rate limit config rejects non-integer values', async () => {
    process.env.RATE_LIMIT_IP_MAX = 'abc'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('RATE_LIMIT_IP_MAX')
  })

  it('collects all validation failures in a single error message', async () => {
    delete process.env.DATABASE_URL
    process.env.PORT = 'invalid'
    process.env.LOG_LEVEL = 'invalid'
    process.env.RATE_LIMIT_IP_MAX = '-1'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(stderrOutput).toContain('DATABASE_URL')
    expect(stderrOutput).toContain('PORT')
    expect(stderrOutput).toContain('LOG_LEVEL')
    expect(stderrOutput).toContain('RATE_LIMIT_IP_MAX')
  })

  it('never logs sensitive values (DATABASE_URL value not in output)', async () => {
    process.env.DATABASE_URL = 'mysql://secret:password@host/db'
    await expect(import('../src/lib/config.js')).rejects.toThrow('process.exit called')
    // The error message should mention DATABASE_URL by name but not its value
    expect(stderrOutput).toContain('DATABASE_URL')
    expect(stderrOutput).not.toContain('secret:password')
  })

  it('config object is frozen (immutable)', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('config object has all expected keys', async () => {
    const { config } = await import('../src/lib/config.js')
    expect(config).toHaveProperty('port')
    expect(config).toHaveProperty('logLevel')
    expect(config).toHaveProperty('databaseUrl')
    expect(config).toHaveProperty('corsAllowedOrigins')
    expect(config).toHaveProperty('nodeEnv')
    expect(config).toHaveProperty('isProduction')
    expect(config).toHaveProperty('rateLimitIpMax')
    expect(config).toHaveProperty('rateLimitWindowMs')
    expect(config).toHaveProperty('rateLimitBlockDurationMs')
    expect(config).toHaveProperty('rateLimitWalletMax')
  })
})
