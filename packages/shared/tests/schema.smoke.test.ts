import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const packageRoot = path.resolve(__dirname, '..')

describe('Schema Smoke Tests - Static Configuration', () => {
  describe('Prisma Schema', () => {
    const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma')

    it('schema.prisma exists at correct path', () => {
      expect(fs.existsSync(schemaPath)).toBe(true)
    })

    it('schema contains env("DATABASE_URL")', () => {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      expect(content).toContain('env("DATABASE_URL")')
    })

    it('schema contains provider = "postgresql"', () => {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      expect(content).toContain('provider = "postgresql"')
    })

    it('schema contains provider = "prisma-client-js"', () => {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      expect(content).toContain('provider = "prisma-client-js"')
    })

    it('schema defines all four models: Wallet, SponsorshipRequest, RelayTransaction, RateLimit', () => {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      expect(content).toContain('model Wallet')
      expect(content).toContain('model SponsorshipRequest')
      expect(content).toContain('model RelayTransaction')
      expect(content).toContain('model RateLimit')
    })

    it('schema defines all three enums: SponsorshipRequestStatus, RelayTransactionStatus, RateLimitIdentifierType', () => {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      expect(content).toContain('enum SponsorshipRequestStatus')
      expect(content).toContain('enum RelayTransactionStatus')
      expect(content).toContain('enum RateLimitIdentifierType')
    })

    it('schema has composite index @@index([identifier, identifierType]) on RateLimit', () => {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      // Extract the RateLimit model block
      const rateLimitMatch = content.match(/model RateLimit \{[\s\S]*?\n\}/)
      expect(rateLimitMatch).not.toBeNull()
      expect(rateLimitMatch![0]).toContain('@@index([identifier, identifierType])')
    })

    it('schema has onDelete: Restrict on relations', () => {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      const restrictMatches = content.match(/onDelete: Restrict/g)
      // Should have at least 2: Wallet->SponsorshipRequest and SponsorshipRequest->RelayTransaction
      expect(restrictMatches).not.toBeNull()
      expect(restrictMatches!.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('package.json', () => {
    const pkgPath = path.join(packageRoot, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

    it('has @prisma/client in dependencies', () => {
      expect(pkg.dependencies).toHaveProperty('@prisma/client')
    })

    it('has prisma in devDependencies', () => {
      expect(pkg.devDependencies).toHaveProperty('prisma')
    })

    it('has generate script', () => {
      expect(pkg.scripts).toHaveProperty('generate')
    })

    it('has build script', () => {
      expect(pkg.scripts).toHaveProperty('build')
    })

    it('has migrate:dev script', () => {
      expect(pkg.scripts).toHaveProperty('migrate:dev')
    })

    it('has migrate:deploy script', () => {
      expect(pkg.scripts).toHaveProperty('migrate:deploy')
    })
  })

  describe('.env.example', () => {
    const envExamplePath = path.join(packageRoot, '.env.example')

    it('contains DATABASE_URL=postgresql://', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8')
      expect(content).toContain('DATABASE_URL=postgresql://')
    })
  })

  describe('.gitignore', () => {
    const gitignorePath = path.join(packageRoot, '.gitignore')

    it('contains .env entry', () => {
      const content = fs.readFileSync(gitignorePath, 'utf-8')
      const lines = content.split('\n').map((l) => l.trim())
      expect(lines).toContain('.env')
    })

    it('contains !.env.example negation', () => {
      const content = fs.readFileSync(gitignorePath, 'utf-8')
      const lines = content.split('\n').map((l) => l.trim())
      expect(lines).toContain('!.env.example')
    })
  })

  describe('No hardcoded connection strings', () => {
    it('no postgresql:// in .ts source files (excluding format hints in error messages)', () => {
      const srcDir = path.join(packageRoot, 'src')
      const tsFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'))

      // Match actual connection strings like postgresql://user:pass@host:port/db
      // but not format placeholders like postgresql://<user>:<password>@<host>:<port>/<database>
      const hardcodedConnStringPattern = /postgresql:\/\/[^<\s]+@[^<\s]+/

      for (const file of tsFiles) {
        const content = fs.readFileSync(path.join(srcDir, file), 'utf-8')
        expect(content).not.toMatch(hardcodedConnStringPattern)
      }
    })
  })
})
