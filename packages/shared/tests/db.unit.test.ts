import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock PrismaClient to avoid needing generated client
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({})),
}))

describe('validateDatabaseUrl', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.DATABASE_URL
    vi.resetModules()
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DATABASE_URL = originalEnv
    } else {
      delete process.env.DATABASE_URL
    }
  })

  it('throws when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL
    // Module-level code calls validateDatabaseUrl during import,
    // so the import itself will reject
    await expect(import('../src/db')).rejects.toThrow()
  })

  it('throws when DATABASE_URL is empty string', async () => {
    process.env.DATABASE_URL = ''
    await expect(import('../src/db')).rejects.toThrow()
  })

  it('throws when DATABASE_URL is whitespace only', async () => {
    process.env.DATABASE_URL = '   \t\n  '
    await expect(import('../src/db')).rejects.toThrow()
  })

  it('error message contains "DATABASE_URL" and the expected format', async () => {
    delete process.env.DATABASE_URL
    await expect(import('../src/db')).rejects.toThrow(/DATABASE_URL/)
    await expect(import('../src/db')).rejects.toThrow(/postgresql:\/\//)
  })

  it('returns the URL when DATABASE_URL is set to a valid value', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/arcpass?schema=public'
    const { validateDatabaseUrl } = await import('../src/db')
    const result = validateDatabaseUrl()
    expect(result).toBe('postgresql://user:pass@localhost:5432/arcpass?schema=public')
  })
})

describe('package exports', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/arcpass?schema=public'
    vi.resetModules()
  })

  it('exports prisma as a named export', async () => {
    const mod = await import('../src/index')
    expect(mod).toHaveProperty('prisma')
  })

  it('exports validateDatabaseUrl as a named export', async () => {
    const mod = await import('../src/index')
    expect(mod).toHaveProperty('validateDatabaseUrl')
    expect(typeof mod.validateDatabaseUrl).toBe('function')
  })
})
