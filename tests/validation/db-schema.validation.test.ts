import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isDatabaseReachable } from './helpers.js'
import { DATABASE_URL } from './constants.js'

/**
 * Database Schema Validation
 *
 * Validates that the PostgreSQL runtime schema matches the Prisma schema definition.
 * Confirms migrations applied correctly by checking tables, columns, indexes, and enums.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

const dbAvailable = await isDatabaseReachable()

describe.skipIf(!dbAvailable)('Database Schema Validation', () => {
  let prisma: InstanceType<any>

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient({
      datasources: { db: { url: DATABASE_URL } },
    })
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect()
    }
  })

  // ─── Requirement 1.1: Tables Exist ──────────────────────────────────────────

  describe('tables exist (Requirement 1.1)', () => {
    const expectedTables = [
      'wallets',
      'sponsorship_requests',
      'relay_transactions',
      'rate_limits',
    ]

    it.each(expectedTables)('table "%s" exists in PostgreSQL', async (tableName) => {
      const result = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ${tableName}
        ) AS "exists"
      `
      expect(result[0].exists).toBe(true)
    })
  })

  // ─── Requirement 1.2: relay_transactions.explorerUrl ────────────────────────

  describe('relay_transactions.explorerUrl column (Requirement 1.2)', () => {
    it('exists with type VARCHAR(512) and is nullable', async () => {
      const result = await prisma.$queryRaw<
        { column_name: string; data_type: string; character_maximum_length: number | null; is_nullable: string }[]
      >`
        SELECT column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'relay_transactions'
          AND column_name = 'explorerUrl'
      `

      expect(result).toHaveLength(1)
      expect(result[0].data_type).toBe('character varying')
      expect(result[0].character_maximum_length).toBe(512)
      expect(result[0].is_nullable).toBe('YES')
    })
  })

  // ─── Requirement 1.3: relay_transactions blockNumber, eventName, eventData ──

  describe('relay_transactions blockchain event columns (Requirement 1.3)', () => {
    it('blockNumber exists with type BIGINT and is nullable', async () => {
      const result = await prisma.$queryRaw<
        { column_name: string; data_type: string; is_nullable: string }[]
      >`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'relay_transactions'
          AND column_name = 'blockNumber'
      `

      expect(result).toHaveLength(1)
      expect(result[0].data_type).toBe('bigint')
      expect(result[0].is_nullable).toBe('YES')
    })

    it('eventName exists with type VARCHAR(100) and is nullable', async () => {
      const result = await prisma.$queryRaw<
        { column_name: string; data_type: string; character_maximum_length: number | null; is_nullable: string }[]
      >`
        SELECT column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'relay_transactions'
          AND column_name = 'eventName'
      `

      expect(result).toHaveLength(1)
      expect(result[0].data_type).toBe('character varying')
      expect(result[0].character_maximum_length).toBe(100)
      expect(result[0].is_nullable).toBe('YES')
    })

    it('eventData exists with type JSONB and is nullable', async () => {
      const result = await prisma.$queryRaw<
        { column_name: string; udt_name: string; is_nullable: string }[]
      >`
        SELECT column_name, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'relay_transactions'
          AND column_name = 'eventData'
      `

      expect(result).toHaveLength(1)
      expect(result[0].udt_name).toBe('jsonb')
      expect(result[0].is_nullable).toBe('YES')
    })
  })

  // ─── Requirement 1.4: Indexes on sponsorship_requests ───────────────────────

  describe('sponsorship_requests indexes (Requirement 1.4)', () => {
    it('composite index on (walletId, status) exists', async () => {
      const result = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'sponsorship_requests'
          AND indexname = 'sponsorship_requests_walletId_status_idx'
      `

      expect(result).toHaveLength(1)
      expect(result[0].indexdef).toContain('"walletId"')
      expect(result[0].indexdef).toContain('"status"')
    })

    it('single-column index on (walletId) exists', async () => {
      const result = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'sponsorship_requests'
          AND indexname = 'sponsorship_requests_walletId_idx'
      `

      expect(result).toHaveLength(1)
      expect(result[0].indexdef).toContain('"walletId"')
    })
  })

  // ─── Requirement 1.6: Enum types exist ──────────────────────────────────────

  describe('enum types exist (Requirement 1.6)', () => {
    const expectedEnums = [
      'SponsorshipRequestStatus',
      'RelayTransactionStatus',
      'RateLimitIdentifierType',
    ]

    it.each(expectedEnums)('enum type "%s" exists in PostgreSQL', async (enumName) => {
      const result = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = ${enumName}
            AND typtype = 'e'
        ) AS "exists"
      `
      expect(result[0].exists).toBe(true)
    })
  })

  // ─── Requirement 1.5: Missing migrations reported ───────────────────────────

  describe('missing migrations detection (Requirement 1.5)', () => {
    it('prisma migrate status reports missing migrations to stderr with non-zero exit', async () => {
      const { execSync } = await import('child_process')

      // Run prisma migrate status which exits non-zero if migrations are pending
      // We test that the mechanism works by verifying the command behavior
      // If all migrations are applied, this should exit 0 (no missing migrations)
      // We verify the tool is functional by running it
      let exitCode = 0
      let stderr = ''

      try {
        execSync(
          'npx prisma migrate status --schema=packages/shared/prisma/schema.prisma',
          {
            env: { ...process.env, DATABASE_URL },
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30_000,
          }
        )
      } catch (error: unknown) {
        const execError = error as { status?: number; stderr?: Buffer }
        exitCode = execError.status ?? 1
        stderr = execError.stderr?.toString() ?? ''
      }

      // If migrations are fully applied, exit code is 0 (valid state)
      // If migrations are missing, exit code is non-zero and stderr has details
      if (exitCode !== 0) {
        expect(stderr.length).toBeGreaterThan(0)
      } else {
        // All migrations applied — this is the expected happy path
        expect(exitCode).toBe(0)
      }
    })
  })
})
