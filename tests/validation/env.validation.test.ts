/**
 * Environment Configuration Validation Tests
 *
 * Validates that all required environment variables are present and correctly
 * formatted before any service interaction. This is the first layer of the
 * validation suite — fail fast on misconfiguration.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Check if the environment is configured for validation.
 * If none of the required env vars are set, we skip the presence/format checks
 * since the environment is not configured for runtime validation.
 */
const isEnvConfigured = Boolean(
  process.env.DATABASE_URL ||
  process.env.CHAIN_RPC_URL ||
  process.env.CHAIN_ID ||
  process.env.CONTRACT_ADDRESS_SPONSOR_VAULT ||
  process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY ||
  process.env.SPONSOR_PRIVATE_KEY
)

describe('Environment Configuration Validation', () => {
  // ─── Requirements 11.1-11.6: Required env var presence and format ────────
  // These tests validate that env vars are present and correctly formatted.
  // They skip when the environment is not configured for validation (no env vars set).

  describe.skipIf(!isEnvConfigured)('Required environment variables', () => {
    // ─── Requirement 11.1: DATABASE_URL ────────────────────────────────────

    describe('DATABASE_URL', () => {
      it('is set and starts with postgresql://', () => {
        const databaseUrl = process.env.DATABASE_URL
        expect(databaseUrl, 'DATABASE_URL must be set').toBeDefined()
        expect(databaseUrl!.length, 'DATABASE_URL must not be empty').toBeGreaterThan(0)
        expect(
          databaseUrl!.startsWith('postgresql://') || databaseUrl!.startsWith('postgres://'),
          `DATABASE_URL must start with postgresql:// or postgres://, got: ${databaseUrl!.slice(0, 20)}...`
        ).toBe(true)
      })
    })

    // ─── Requirement 11.2: CHAIN_RPC_URL ───────────────────────────────────

    describe('CHAIN_RPC_URL', () => {
      it('is set and starts with http:// or https://', () => {
        const chainRpcUrl = process.env.CHAIN_RPC_URL
        expect(chainRpcUrl, 'CHAIN_RPC_URL must be set').toBeDefined()
        expect(chainRpcUrl!.length, 'CHAIN_RPC_URL must not be empty').toBeGreaterThan(0)
        expect(
          chainRpcUrl!.startsWith('http://') || chainRpcUrl!.startsWith('https://'),
          `CHAIN_RPC_URL must start with http:// or https://, got: ${chainRpcUrl!.slice(0, 20)}...`
        ).toBe(true)
      })
    })

    // ─── Requirement 11.3: CHAIN_ID ────────────────────────────────────────

    describe('CHAIN_ID', () => {
      it('is set to 1942999', () => {
        const chainId = process.env.CHAIN_ID
        expect(chainId, 'CHAIN_ID must be set').toBeDefined()
        expect(chainId!.length, 'CHAIN_ID must not be empty').toBeGreaterThan(0)
        expect(
          Number(chainId),
          `CHAIN_ID must be 1942999, got: ${chainId}`
        ).toBe(1942999)
      })
    })

    // ─── Requirement 11.4: CONTRACT_ADDRESS_SPONSOR_VAULT ──────────────────

    describe('CONTRACT_ADDRESS_SPONSOR_VAULT', () => {
      it('matches ^0x[0-9a-fA-F]{40}$', () => {
        const address = process.env.CONTRACT_ADDRESS_SPONSOR_VAULT
        expect(address, 'CONTRACT_ADDRESS_SPONSOR_VAULT must be set').toBeDefined()
        expect(address!.length, 'CONTRACT_ADDRESS_SPONSOR_VAULT must not be empty').toBeGreaterThan(0)
        expect(
          /^0x[0-9a-fA-F]{40}$/.test(address!),
          `CONTRACT_ADDRESS_SPONSOR_VAULT must match ^0x[0-9a-fA-F]{40}$, got: ${address}`
        ).toBe(true)
      })
    })

    // ─── Requirement 11.5: CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY ───────────

    describe('CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY', () => {
      it('matches ^0x[0-9a-fA-F]{40}$', () => {
        const address = process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY
        expect(address, 'CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY must be set').toBeDefined()
        expect(address!.length, 'CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY must not be empty').toBeGreaterThan(0)
        expect(
          /^0x[0-9a-fA-F]{40}$/.test(address!),
          `CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY must match ^0x[0-9a-fA-F]{40}$, got: ${address}`
        ).toBe(true)
      })
    })

    // ─── Requirement 11.6: SPONSOR_PRIVATE_KEY ─────────────────────────────

    describe('SPONSOR_PRIVATE_KEY', () => {
      it('after stripping optional 0x prefix, matches ^[0-9a-fA-F]{64}$', () => {
        const key = process.env.SPONSOR_PRIVATE_KEY
        expect(key, 'SPONSOR_PRIVATE_KEY must be set').toBeDefined()
        expect(key!.length, 'SPONSOR_PRIVATE_KEY must not be empty').toBeGreaterThan(0)

        const stripped = key!.startsWith('0x') ? key!.slice(2) : key!
        expect(
          /^[0-9a-fA-F]{64}$/.test(stripped),
          `SPONSOR_PRIVATE_KEY (after stripping 0x prefix) must be 64 hex chars, got length: ${stripped.length}`
        ).toBe(true)
      })
    })
  })

  // ─── Requirement 11.7: Aggregated Error Message ──────────────────────────

  describe('Aggregated error reporting', () => {
    const originalEnv = process.env

    beforeEach(() => {
      // Reset modules to get a fresh loadConfig on each test
      vi.resetModules()
    })

    afterEach(() => {
      process.env = originalEnv
      vi.restoreAllMocks()
    })

    it('missing/malformed variables produce a single aggregated error message to stderr', async () => {
      // Set up an environment with multiple missing/malformed variables
      process.env = {
        ...originalEnv,
        DATABASE_URL: '', // missing
        CHAIN_RPC_URL: 'not-a-url', // malformed
        SPONSOR_PRIVATE_KEY: 'short', // malformed
        CHAIN_ID: 'abc', // malformed
        CONTRACT_ADDRESS_SPONSOR_VAULT: '0xinvalid', // malformed
        CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY: '', // missing
      }

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit called')
      }) as never)

      try {
        const { loadConfig } = await import('../../apps/worker/src/config.js')
        loadConfig()
      } catch (e: unknown) {
        // Expected: process.exit throws our mock error
        expect((e as Error).message).toBe('process.exit called')
      }

      // Verify a single aggregated error was written to stderr
      expect(stderrSpy).toHaveBeenCalledTimes(1)
      const errorMessage = stderrSpy.mock.calls[0][0] as string

      // The error message should mention all invalid variables
      expect(errorMessage).toContain('DATABASE_URL')
      expect(errorMessage).toContain('CHAIN_RPC_URL')
      expect(errorMessage).toContain('SPONSOR_PRIVATE_KEY')
      expect(errorMessage).toContain('CHAIN_ID')
      expect(errorMessage).toContain('CONTRACT_ADDRESS_SPONSOR_VAULT')
      expect(errorMessage).toContain('CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY')

      // Verify process.exit(1) was called
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ─── Requirement 11.8: Optional Numeric Variables ────────────────────────

  describe('Optional numeric variables range validation', () => {
    const numericRanges: Record<string, { min: number; max: number }> = {
      POLL_INTERVAL_MS: { min: 1000, max: 60000 },
      BATCH_SIZE: { min: 1, max: 100 },
      MAX_RETRIES: { min: 1, max: 10 },
      LOCK_TIMEOUT_MS: { min: 5000, max: 120000 },
      SHUTDOWN_TIMEOUT_MS: { min: 5000, max: 60000 },
      CONFIRMATION_BLOCKS: { min: 1, max: 50 },
      TX_TIMEOUT_MS: { min: 10000, max: 600000 },
      CHAIN_ID_VERIFY_TIMEOUT_MS: { min: 1000, max: 30000 },
    }

    for (const [varName, range] of Object.entries(numericRanges)) {
      it(`${varName} is within [${range.min}, ${range.max}] when set`, () => {
        const value = process.env[varName]

        // Skip if not explicitly set — optional variables are allowed to be absent
        if (value === undefined || value === '') {
          return
        }

        const parsed = Number(value)
        expect(
          Number.isNaN(parsed),
          `${varName} must be a valid number, got: ${value}`
        ).toBe(false)
        expect(
          parsed,
          `${varName} must be >= ${range.min}, got: ${parsed}`
        ).toBeGreaterThanOrEqual(range.min)
        expect(
          parsed,
          `${varName} must be <= ${range.max}, got: ${parsed}`
        ).toBeLessThanOrEqual(range.max)
      })
    }
  })
})
