import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadConfig } from '../../src/config.js'

// Mock process.exit to throw instead of actually exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  throw new Error(`process.exit(${code})`)
}) as any)

// Mock process.stderr.write to capture error output
let stderrOutput = ''
const mockStderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: any) => {
  stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString()
  return true
}) as any)

// Base valid env vars (all required vars present)
const baseEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://localhost:5432/arcpass',
  CHAIN_RPC_URL: 'https://rpc.example.com',
  SPONSOR_PRIVATE_KEY: 'a'.repeat(64),
  CHAIN_ID: '1337',
  CONTRACT_ADDRESS_SPONSOR_VAULT: '0x' + 'a'.repeat(40),
  CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY: '0x' + 'b'.repeat(40),
}

describe('loadConfig', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    // Clear all env vars that loadConfig reads
    Object.keys(baseEnv).forEach((key) => delete process.env[key])
    delete process.env.POLL_INTERVAL_MS
    delete process.env.BATCH_SIZE
    delete process.env.MAX_RETRIES
    delete process.env.LOCK_TIMEOUT_MS
    delete process.env.SHUTDOWN_TIMEOUT_MS
    delete process.env.CONFIRMATION_BLOCKS
    delete process.env.TX_TIMEOUT_MS
    delete process.env.SPONSORSHIP_AMOUNT_WEI
    delete process.env.CHAIN_ID_VERIFY_TIMEOUT_MS
    delete process.env.EXPLORER_BASE_URL
    mockExit.mockClear()
    mockStderrWrite.mockClear()
    stderrOutput = ''
  })

  afterEach(() => {
    process.env = originalEnv
  })

  function setBaseEnv() {
    Object.entries(baseEnv).forEach(([key, value]) => {
      process.env[key] = value
    })
  }

  /** Helper to get the error message written to stderr */
  function getStderrMessage(): string {
    return stderrOutput.trim()
  }

  describe('new required fields', () => {
    it('returns chainId as a number', () => {
      setBaseEnv()
      const config = loadConfig()
      expect(config.chainId).toBe(1337)
    })

    it('returns contractAddressSponsorVault', () => {
      setBaseEnv()
      const config = loadConfig()
      expect(config.contractAddressSponsorVault).toBe('0x' + 'a'.repeat(40))
    })

    it('returns contractAddressSponsorshipRegistry', () => {
      setBaseEnv()
      const config = loadConfig()
      expect(config.contractAddressSponsorshipRegistry).toBe('0x' + 'b'.repeat(40))
    })
  })

  describe('optional fields with defaults', () => {
    it('defaults sponsorshipAmount to 1000000000000000n', () => {
      setBaseEnv()
      const config = loadConfig()
      expect(config.sponsorshipAmount).toBe(1000000000000000n)
    })

    it('parses SPONSORSHIP_AMOUNT_WEI when provided', () => {
      setBaseEnv()
      process.env.SPONSORSHIP_AMOUNT_WEI = '5000000000000000'
      const config = loadConfig()
      expect(config.sponsorshipAmount).toBe(5000000000000000n)
    })

    it('defaults chainIdVerifyTimeoutMs to 10000', () => {
      setBaseEnv()
      const config = loadConfig()
      expect(config.chainIdVerifyTimeoutMs).toBe(10000)
    })

    it('parses CHAIN_ID_VERIFY_TIMEOUT_MS when provided', () => {
      setBaseEnv()
      process.env.CHAIN_ID_VERIFY_TIMEOUT_MS = '5000'
      const config = loadConfig()
      expect(config.chainIdVerifyTimeoutMs).toBe(5000)
    })
  })

  describe('missing required variables - reports ALL at once', () => {
    it('reports all missing required vars in a single error', () => {
      // Don't set any env vars
      expect(() => loadConfig()).toThrow('process.exit')
      expect(mockStderrWrite).toHaveBeenCalledTimes(1)
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('DATABASE_URL')
      expect(errorMsg).toContain('CHAIN_RPC_URL')
      expect(errorMsg).toContain('SPONSOR_PRIVATE_KEY')
      expect(errorMsg).toContain('CHAIN_ID')
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSOR_VAULT')
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY')
    })

    it('reports subset of missing vars', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/arcpass'
      process.env.CHAIN_RPC_URL = 'https://rpc.example.com'
      process.env.SPONSOR_PRIVATE_KEY = 'a'.repeat(64)
      // Missing: CHAIN_ID, CONTRACT_ADDRESS_SPONSOR_VAULT, CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY

      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_ID')
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSOR_VAULT')
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY')
      expect(errorMsg).not.toContain('DATABASE_URL')
      expect(errorMsg).not.toContain('CHAIN_RPC_URL')
      expect(errorMsg).not.toContain('SPONSOR_PRIVATE_KEY')
    })

    it('rejects whitespace-only required vars as missing', () => {
      setBaseEnv()
      process.env.DATABASE_URL = '   '
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('DATABASE_URL')
    })
  })

  describe('format validation - reports ALL invalid vars at once', () => {
    it('reports multiple format errors in a single message', () => {
      setBaseEnv()
      process.env.CHAIN_RPC_URL = 'ftp://invalid'
      process.env.CHAIN_ID = 'abc'
      process.env.SPONSOR_PRIVATE_KEY = 'short'
      process.env.CONTRACT_ADDRESS_SPONSOR_VAULT = 'invalid'

      expect(() => loadConfig()).toThrow('process.exit')
      expect(mockStderrWrite).toHaveBeenCalledTimes(1)
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_RPC_URL')
      expect(errorMsg).toContain('CHAIN_ID')
      expect(errorMsg).toContain('SPONSOR_PRIVATE_KEY')
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSOR_VAULT')
    })

    it('reports both missing and format errors together', () => {
      // DATABASE_URL is missing, CHAIN_RPC_URL has bad format
      process.env.CHAIN_RPC_URL = 'ftp://invalid'
      process.env.SPONSOR_PRIVATE_KEY = 'a'.repeat(64)
      process.env.CHAIN_ID = '1337'
      process.env.CONTRACT_ADDRESS_SPONSOR_VAULT = '0x' + 'a'.repeat(40)
      process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY = '0x' + 'b'.repeat(40)

      expect(() => loadConfig()).toThrow('process.exit')
      expect(mockStderrWrite).toHaveBeenCalledTimes(1)
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('DATABASE_URL')
      expect(errorMsg).toContain('CHAIN_RPC_URL')
    })
  })

  describe('CHAIN_RPC_URL validation', () => {
    it('accepts http:// prefix', () => {
      setBaseEnv()
      process.env.CHAIN_RPC_URL = 'http://localhost:8545'
      const config = loadConfig()
      expect(config.chainRpcUrl).toBe('http://localhost:8545')
    })

    it('accepts https:// prefix', () => {
      setBaseEnv()
      process.env.CHAIN_RPC_URL = 'https://rpc.example.com'
      const config = loadConfig()
      expect(config.chainRpcUrl).toBe('https://rpc.example.com')
    })

    it('rejects ftp:// prefix', () => {
      setBaseEnv()
      process.env.CHAIN_RPC_URL = 'ftp://rpc.example.com'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_RPC_URL')
    })

    it('rejects ws:// prefix', () => {
      setBaseEnv()
      process.env.CHAIN_RPC_URL = 'ws://rpc.example.com'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_RPC_URL')
    })
  })

  describe('SPONSOR_PRIVATE_KEY validation', () => {
    it('accepts 64-char hex without 0x prefix', () => {
      setBaseEnv()
      process.env.SPONSOR_PRIVATE_KEY = 'a'.repeat(64)
      const config = loadConfig()
      expect(config.sponsorPrivateKey).toBe('a'.repeat(64))
    })

    it('accepts 64-char hex with 0x prefix', () => {
      setBaseEnv()
      process.env.SPONSOR_PRIVATE_KEY = '0x' + 'b'.repeat(64)
      const config = loadConfig()
      expect(config.sponsorPrivateKey).toBe('0x' + 'b'.repeat(64))
    })

    it('accepts mixed-case hex', () => {
      setBaseEnv()
      process.env.SPONSOR_PRIVATE_KEY = 'aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF00112233445566778899'
      const config = loadConfig()
      expect(config.sponsorPrivateKey).toBe('aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF00112233445566778899')
    })

    it('rejects key shorter than 64 chars', () => {
      setBaseEnv()
      process.env.SPONSOR_PRIVATE_KEY = 'a'.repeat(63)
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('SPONSOR_PRIVATE_KEY')
    })

    it('rejects key longer than 64 chars (without 0x)', () => {
      setBaseEnv()
      process.env.SPONSOR_PRIVATE_KEY = 'a'.repeat(65)
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('SPONSOR_PRIVATE_KEY')
    })

    it('rejects non-hex characters', () => {
      setBaseEnv()
      process.env.SPONSOR_PRIVATE_KEY = 'g'.repeat(64)
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('SPONSOR_PRIVATE_KEY')
    })
  })

  describe('CHAIN_ID validation', () => {
    it('rejects non-integer CHAIN_ID', () => {
      setBaseEnv()
      process.env.CHAIN_ID = '3.14'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_ID')
    })

    it('rejects zero CHAIN_ID', () => {
      setBaseEnv()
      process.env.CHAIN_ID = '0'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_ID')
    })

    it('rejects negative CHAIN_ID', () => {
      setBaseEnv()
      process.env.CHAIN_ID = '-1'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_ID')
    })

    it('rejects non-numeric CHAIN_ID', () => {
      setBaseEnv()
      process.env.CHAIN_ID = 'abc'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_ID')
    })

    it('accepts valid positive integer CHAIN_ID', () => {
      setBaseEnv()
      process.env.CHAIN_ID = '42161'
      const config = loadConfig()
      expect(config.chainId).toBe(42161)
    })
  })

  describe('contract address validation', () => {
    it('rejects CONTRACT_ADDRESS_SPONSOR_VAULT without 0x prefix', () => {
      setBaseEnv()
      process.env.CONTRACT_ADDRESS_SPONSOR_VAULT = 'a'.repeat(42)
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSOR_VAULT')
    })

    it('rejects CONTRACT_ADDRESS_SPONSOR_VAULT with wrong length', () => {
      setBaseEnv()
      process.env.CONTRACT_ADDRESS_SPONSOR_VAULT = '0x' + 'a'.repeat(39)
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSOR_VAULT')
    })

    it('rejects CONTRACT_ADDRESS_SPONSOR_VAULT with invalid hex chars', () => {
      setBaseEnv()
      process.env.CONTRACT_ADDRESS_SPONSOR_VAULT = '0x' + 'g'.repeat(40)
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSOR_VAULT')
    })

    it('rejects CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY with invalid format', () => {
      setBaseEnv()
      process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY = 'invalid'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY')
    })

    it('accepts valid mixed-case contract addresses', () => {
      setBaseEnv()
      process.env.CONTRACT_ADDRESS_SPONSOR_VAULT = '0x' + 'aAbBcCdDeEfF00112233'.repeat(2)
      const config = loadConfig()
      expect(config.contractAddressSponsorVault).toBe('0x' + 'aAbBcCdDeEfF00112233'.repeat(2))
    })
  })

  describe('CHAIN_ID_VERIFY_TIMEOUT_MS range validation', () => {
    it('rejects value below 1000', () => {
      setBaseEnv()
      process.env.CHAIN_ID_VERIFY_TIMEOUT_MS = '999'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_ID_VERIFY_TIMEOUT_MS')
    })

    it('rejects value above 30000', () => {
      setBaseEnv()
      process.env.CHAIN_ID_VERIFY_TIMEOUT_MS = '30001'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).toContain('CHAIN_ID_VERIFY_TIMEOUT_MS')
    })
  })

  describe('sensitive values never logged', () => {
    it('never includes DATABASE_URL value in error output', () => {
      setBaseEnv()
      process.env.DATABASE_URL = 'postgresql://user:secret@host:5432/db'
      process.env.CHAIN_ID = 'invalid'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).not.toContain('postgresql://user:secret@host:5432/db')
      expect(errorMsg).not.toContain('secret')
    })

    it('never includes SPONSOR_PRIVATE_KEY value in error output', () => {
      setBaseEnv()
      process.env.SPONSOR_PRIVATE_KEY = 'deadbeef'.repeat(8)
      process.env.CHAIN_ID = 'invalid'
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      expect(errorMsg).not.toContain('deadbeef'.repeat(8))
    })

    it('only includes variable names in error output', () => {
      // All vars missing
      expect(() => loadConfig()).toThrow('process.exit')
      const errorMsg = getStderrMessage()
      // Should only contain variable names, not values
      expect(errorMsg).toMatch(/^Invalid or missing environment variables:/)
      expect(errorMsg).toContain('DATABASE_URL')
      expect(errorMsg).toContain('CHAIN_RPC_URL')
    })
  })

  describe('frozen config object', () => {
    it('returns a frozen config object', () => {
      setBaseEnv()
      const config = loadConfig()
      expect(Object.isFrozen(config)).toBe(true)
    })

    it('prevents mutation of config properties', () => {
      setBaseEnv()
      const config = loadConfig()
      expect(() => {
        ;(config as any).chainId = 9999
      }).toThrow()
    })
  })

  describe('exits with non-zero code', () => {
    it('calls process.exit(1) on validation failure', () => {
      expect(() => loadConfig()).toThrow('process.exit(1)')
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('writes error to stderr (not stdout)', () => {
      expect(() => loadConfig()).toThrow('process.exit')
      expect(mockStderrWrite).toHaveBeenCalled()
    })
  })
})
