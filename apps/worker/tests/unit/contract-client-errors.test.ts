import { describe, it, expect } from 'vitest'
import { encodeErrorResult, keccak256, toBytes } from 'viem'
import type { Abi } from 'viem'
import { handleExecutionError, formatDecodedError } from '../../src/contract-client.js'

// Minimal SponsorVault ABI with custom errors for testing
const sponsorVaultAbi: Abi = [
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'ExceedsLimit', inputs: [{ name: 'requested', type: 'uint256' }, { name: 'limit', type: 'uint256' }] },
  { type: 'error', name: 'InsufficientBalance', inputs: [{ name: 'requested', type: 'uint256' }, { name: 'available', type: 'uint256' }] },
  { type: 'error', name: 'AlreadySponsored', inputs: [{ name: 'recipient', type: 'address' }] },
  { type: 'error', name: 'InvalidRecipient', inputs: [] },
  { type: 'error', name: 'InvalidAmount', inputs: [] },
]

/**
 * Helper to build a viem-like error with embedded error data.
 * Uses a message that won't trigger the network error pattern checks.
 */
function makeErrorWithData(data: `0x${string}`, message = 'execution reverted'): Error {
  const err = new Error(message) as Error & { data: string }
  err.data = data
  return err
}

describe('handleExecutionError', () => {
  describe('known custom error decoding (Requirement 3.6)', () => {
    it('decodes AlreadySponsored error and includes error name in failureReason', () => {
      const data = encodeErrorResult({
        abi: sponsorVaultAbi,
        errorName: 'AlreadySponsored',
        args: ['0x1234567890abcdef1234567890abcdef12345678'],
      })

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toContain('AlreadySponsored')
    })

    it('decodes Unauthorized error and includes error name in failureReason', () => {
      const data = encodeErrorResult({
        abi: sponsorVaultAbi,
        errorName: 'Unauthorized',
        args: [],
      })

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toContain('Unauthorized')
    })

    it('decodes ExceedsLimit error with arguments', () => {
      const data = encodeErrorResult({
        abi: sponsorVaultAbi,
        errorName: 'ExceedsLimit',
        args: [100n, 10n],
      })

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toContain('ExceedsLimit')
      expect(result).toContain('100')
      expect(result).toContain('10')
    })

    it('decodes InsufficientBalance error with arguments', () => {
      const data = encodeErrorResult({
        abi: sponsorVaultAbi,
        errorName: 'InsufficientBalance',
        args: [500n, 100n],
      })

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toContain('InsufficientBalance')
      expect(result).toContain('500')
      expect(result).toContain('100')
    })

    it('decodes InvalidRecipient error', () => {
      const data = encodeErrorResult({
        abi: sponsorVaultAbi,
        errorName: 'InvalidRecipient',
        args: [],
      })

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toContain('InvalidRecipient')
    })

    it('decodes InvalidAmount error', () => {
      const data = encodeErrorResult({
        abi: sponsorVaultAbi,
        errorName: 'InvalidAmount',
        args: [],
      })

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toContain('InvalidAmount')
    })
  })

  describe('fallback for unknown revert errors (Requirement 3.7)', () => {
    it('returns "Transaction reverted on-chain" when error data exists but cannot be decoded', () => {
      // Unknown selector that doesn't match any error in the ABI
      const data = '0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toBe('Transaction reverted on-chain')
    })

    it('returns "Transaction reverted on-chain" for minimal unknown error data', () => {
      // Just 4 bytes of unknown selector
      const data = '0xaabbccdd' as `0x${string}`

      const error = makeErrorWithData(data)
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toBe('Transaction reverted on-chain')
    })
  })

  describe('non-revert errors', () => {
    it('returns error message when no error data is present and no pattern matches', () => {
      const error = new Error('Some unexpected error occurred')
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toBe('Some unexpected error occurred')
    })

    it('returns timeout message for timeout errors', () => {
      const error = new Error('Request timed out after 120000ms')
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toBe('Transaction confirmation timeout')
    })

    it('handles non-Error values', () => {
      const result = handleExecutionError('some string error', sponsorVaultAbi)
      expect(result).toBe('some string error')
    })

    it('returns connection error for ECONNREFUSED', () => {
      const error = new Error('ECONNREFUSED: connection refused')
      const result = handleExecutionError(error, sponsorVaultAbi)

      expect(result).toContain('Connection error')
    })
  })
})

describe('formatDecodedError', () => {
  it('formats Unauthorized error', () => {
    const result = formatDecodedError({ errorName: 'Unauthorized', args: [] })
    expect(result).toBe('Unauthorized: caller is not the operator')
  })

  it('formats ExceedsLimit with args', () => {
    const result = formatDecodedError({ errorName: 'ExceedsLimit', args: [100n, 10n] })
    expect(result).toBe('ExceedsLimit: requested 100, limit 10')
  })

  it('formats InsufficientBalance with args', () => {
    const result = formatDecodedError({ errorName: 'InsufficientBalance', args: [500n, 100n] })
    expect(result).toBe('InsufficientBalance: requested 500, available 100')
  })

  it('formats AlreadySponsored with address', () => {
    const result = formatDecodedError({ errorName: 'AlreadySponsored', args: ['0x1234567890abcdef1234567890abcdef12345678'] })
    expect(result).toBe('AlreadySponsored: 0x1234567890abcdef1234567890abcdef12345678')
  })

  it('formats InvalidRecipient', () => {
    const result = formatDecodedError({ errorName: 'InvalidRecipient', args: [] })
    expect(result).toBe('InvalidRecipient: recipient address is invalid')
  })

  it('formats InvalidAmount', () => {
    const result = formatDecodedError({ errorName: 'InvalidAmount', args: [] })
    expect(result).toBe('InvalidAmount: sponsorship amount is invalid')
  })

  it('formats unknown error names with generic prefix', () => {
    const result = formatDecodedError({ errorName: 'SomeNewError', args: [] })
    expect(result).toBe('Contract error: SomeNewError')
  })
})
