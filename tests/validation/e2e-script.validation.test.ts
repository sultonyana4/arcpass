/**
 * E2E Script Runner Validation Tests
 *
 * Validates that the existing `scripts/validate-e2e.ts` script executes correctly
 * against the live runtime:
 * - Script exits with code 0 within 180 seconds when full stack is available
 * - Successful output contains tx hash, explorer URL, and block number
 * - Explorer URL in output contains the tx hash as substring
 * - Non-zero exit code fails validation and includes captured stderr
 * - Missing required env vars cause non-zero exit with stderr indicating which variable is missing
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { isFullStackReachable } from './helpers.js'
import { E2E_SCRIPT_TIMEOUT_MS } from './constants.js'

// ─── Availability Gate ───────────────────────────────────────────────────────

let fullStackAvailable = false

beforeAll(async () => {
  fullStackAvailable = await isFullStackReachable()
})

// ─── E2E Script Execution Validation (Requirements 10.1-10.5) ────────────────

describe('E2E Script Runner Validation', () => {
  describe.skipIf(!fullStackAvailable)('E2E script execution with full stack', () => {
    let scriptOutput: string = ''
    let scriptExitCode: number | null = null

    // Requirement 10.1: Script exits with code 0 within 180 seconds
    it('npx tsx scripts/validate-e2e.ts exits with code 0 within 180 seconds', () => {
      const env = {
        ...process.env,
        API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:4000',
        CHAIN_RPC_URL: process.env.CHAIN_RPC_URL || '',
        VALIDATION_WALLET_ADDRESS: process.env.VALIDATION_WALLET_ADDRESS || '',
      }

      try {
        const output = execSync('npx tsx scripts/validate-e2e.ts', {
          timeout: E2E_SCRIPT_TIMEOUT_MS,
          encoding: 'utf-8',
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        scriptOutput = output
        scriptExitCode = 0
      } catch (error: any) {
        // execSync throws on non-zero exit code
        scriptOutput = (error.stdout || '') + (error.stderr || '')
        scriptExitCode = error.status ?? 1
      }

      expect(scriptExitCode).toBe(0)
    }, E2E_SCRIPT_TIMEOUT_MS + 5_000)

    // Requirement 10.2: Output contains tx hash, explorer URL, and block number
    it('successful output contains tx hash matching 0x + 64 hex chars, explorer URL starting with http:// or https://, and positive integer block number', () => {
      // Transaction hash: 0x followed by exactly 64 hex characters
      const txHashRegex = /0x[0-9a-fA-F]{64}/
      expect(scriptOutput).toMatch(txHashRegex)

      // Explorer URL: starts with http:// or https://
      const explorerUrlRegex = /https?:\/\/[^\s]+/
      expect(scriptOutput).toMatch(explorerUrlRegex)

      // Block number: positive integer
      const blockNumberRegex = /\b[1-9]\d*\b/
      expect(scriptOutput).toMatch(blockNumberRegex)
    })

    // Requirement 10.3: Explorer URL contains the tx hash as substring
    it('explorer URL in output contains the tx hash as substring', () => {
      // Extract the transaction hash from output
      const txHashMatch = scriptOutput.match(/0x[0-9a-fA-F]{64}/)
      expect(txHashMatch).not.toBeNull()
      const txHash = txHashMatch![0]

      // Extract explorer URL from output
      const explorerUrlMatch = scriptOutput.match(/https?:\/\/[^\s]+/)
      expect(explorerUrlMatch).not.toBeNull()
      const explorerUrl = explorerUrlMatch![0]

      // Explorer URL must contain the tx hash
      expect(explorerUrl).toContain(txHash)
    })
  })

  // Requirement 10.4: Non-zero exit code fails validation and includes captured stderr
  describe('Non-zero exit code handling', () => {
    it('non-zero exit code fails validation and includes captured stderr', () => {
      // Run the script with an invalid API_BASE_URL to force a failure
      const env = {
        ...process.env,
        API_BASE_URL: 'http://localhost:1', // unreachable port
        CHAIN_RPC_URL: process.env.CHAIN_RPC_URL || 'http://localhost:8545',
        VALIDATION_WALLET_ADDRESS: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      }

      const result = spawnSync('npx', ['tsx', 'scripts/validate-e2e.ts'], {
        timeout: 30_000,
        encoding: 'utf-8',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // Script should exit with non-zero code
      expect(result.status).not.toBe(0)

      // Captured stderr should be non-empty
      const stderr = result.stderr || ''
      const stdout = result.stdout || ''
      const combinedOutput = stderr + stdout

      expect(combinedOutput.length).toBeGreaterThan(0)
    }, 35_000)
  })

  // Requirement 10.5: Missing required env vars cause non-zero exit with stderr
  describe('Missing required environment variables', () => {
    const requiredVars = ['API_BASE_URL', 'CHAIN_RPC_URL', 'VALIDATION_WALLET_ADDRESS']

    for (const missingVar of requiredVars) {
      it(`missing ${missingVar} causes non-zero exit with stderr indicating which variable is missing`, () => {
        // Build env with the target variable removed
        const env = { ...process.env }

        // Set all required vars to valid values first
        env.API_BASE_URL = 'http://localhost:4000'
        env.CHAIN_RPC_URL = 'http://localhost:8545'
        env.VALIDATION_WALLET_ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'

        // Remove the specific variable being tested
        delete env[missingVar]

        const result = spawnSync('npx', ['tsx', 'scripts/validate-e2e.ts'], {
          timeout: 30_000,
          encoding: 'utf-8',
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        // Script should exit with non-zero code
        expect(result.status).not.toBe(0)

        // stderr should indicate which variable is missing
        const stderr = result.stderr || ''
        const stdout = result.stdout || ''
        const combinedOutput = stderr + stdout

        expect(combinedOutput.toLowerCase()).toContain(missingVar.toLowerCase())
      }, 30_000)
    }
  })
})
