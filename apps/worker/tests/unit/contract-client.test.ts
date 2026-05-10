import { describe, it, expect } from 'vitest'
import { handleExecutionError, truncateReason } from '../../src/contract-client.js'
import type { Abi } from 'viem'

// Minimal ABI for testing — no custom errors defined
const emptyAbi: Abi = []

describe('handleExecutionError', () => {
  describe('connection timeout/refused errors', () => {
    it('returns failure with descriptive reason for ECONNREFUSED', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:8545')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toContain('Connection error')
      expect(result).toContain('ECONNREFUSED')
    })

    it('returns failure with descriptive reason for ETIMEDOUT', () => {
      const error = new Error('connect ETIMEDOUT 10.0.0.1:8545')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toContain('Connection error')
      expect(result).toContain('ETIMEDOUT')
    })

    it('returns failure with descriptive reason for generic connect error', () => {
      const error = new Error('Failed to connect to RPC endpoint')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toContain('Connection error')
      expect(result).toContain('connect')
    })
  })

  describe('nonce-too-low errors', () => {
    it('includes "nonce" in failureReason for nonce too low', () => {
      const error = new Error('nonce too low: next nonce 5, got 3')
      const result = handleExecutionError(error, emptyAbi)
      expect(result.toLowerCase()).toContain('nonce')
    })

    it('includes "nonce" in failureReason for replacement underpriced', () => {
      const error = new Error('replacement transaction underpriced: nonce has been used')
      const result = handleExecutionError(error, emptyAbi)
      expect(result.toLowerCase()).toContain('nonce')
    })
  })

  describe('waitForTransactionReceipt timeout', () => {
    it('returns "Transaction confirmation timeout" for timed out', () => {
      const error = new Error('waitForTransactionReceipt timed out after 120000ms')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toBe('Transaction confirmation timeout')
    })

    it('returns "Transaction confirmation timeout" for timeout keyword', () => {
      const error = new Error('Transaction receipt polling timeout exceeded')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toBe('Transaction confirmation timeout')
    })
  })

  describe('gas estimation failures', () => {
    it('returns failure for gas estimation error', () => {
      const error = new Error('gas required exceeds allowance (30000000)')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toContain('Gas estimation failed')
    })

    it('returns failure for intrinsic gas too low', () => {
      const error = new Error('intrinsic gas too low')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toContain('Gas estimation failed')
    })
  })

  describe('HTTP 429 rate limiting', () => {
    it('returns failureReason containing "rate limited" for 429 status', () => {
      const error = new Error('HTTP request failed with status 429')
      const result = handleExecutionError(error, emptyAbi)
      expect(result.toLowerCase()).toContain('rate limited')
    })

    it('returns failureReason containing "rate limited" for rate limit message', () => {
      const error = new Error('Rate limit exceeded, please retry later')
      const result = handleExecutionError(error, emptyAbi)
      expect(result.toLowerCase()).toContain('rate limited')
    })
  })

  describe('non-Error values', () => {
    it('converts non-Error to string', () => {
      const result = handleExecutionError('some string error', emptyAbi)
      expect(result).toBe('some string error')
    })

    it('converts number to string', () => {
      const result = handleExecutionError(42, emptyAbi)
      expect(result).toBe('42')
    })
  })

  describe('unknown errors fall through to raw message', () => {
    it('returns raw error message for unrecognized errors', () => {
      const error = new Error('Something completely unexpected happened')
      const result = handleExecutionError(error, emptyAbi)
      expect(result).toBe('Something completely unexpected happened')
    })
  })
})

describe('truncateReason', () => {
  it('returns input unchanged when <= 1000 chars', () => {
    const input = 'a'.repeat(1000)
    expect(truncateReason(input)).toBe(input)
  })

  it('truncates to 997 chars + "..." when > 1000 chars', () => {
    const input = 'x'.repeat(1500)
    const result = truncateReason(input)
    expect(result.length).toBe(1000)
    expect(result).toBe('x'.repeat(997) + '...')
  })

  it('returns short strings unchanged', () => {
    expect(truncateReason('hello')).toBe('hello')
  })

  it('handles exactly 1001 chars', () => {
    const input = 'a'.repeat(1001)
    const result = truncateReason(input)
    expect(result.length).toBe(1000)
    expect(result.endsWith('...')).toBe(true)
  })
})
