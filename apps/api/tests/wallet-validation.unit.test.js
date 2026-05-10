import { describe, it, expect } from 'vitest'
import { isValidWalletAddress, normalizeWalletAddress } from '../src/lib/wallet-validation.js'

describe('isValidWalletAddress', () => {
  it('returns true for a valid lowercase address', () => {
    expect(isValidWalletAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true)
  })

  it('returns true for a valid mixed-case address', () => {
    expect(isValidWalletAddress('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toBe(true)
  })

  it('returns true for a valid address with leading/trailing whitespace', () => {
    expect(isValidWalletAddress('  0x1234567890abcdef1234567890abcdef12345678  ')).toBe(true)
  })

  it('returns false for an address without 0x prefix', () => {
    expect(isValidWalletAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false)
  })

  it('returns false for an address that is too short', () => {
    expect(isValidWalletAddress('0x1234')).toBe(false)
  })

  it('returns false for an address that is too long', () => {
    expect(isValidWalletAddress('0x1234567890abcdef1234567890abcdef1234567890')).toBe(false)
  })

  it('returns false for an address with non-hex characters', () => {
    expect(isValidWalletAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isValidWalletAddress('')).toBe(false)
  })

  it('returns false for non-string input', () => {
    expect(isValidWalletAddress(null)).toBe(false)
    expect(isValidWalletAddress(undefined)).toBe(false)
    expect(isValidWalletAddress(123)).toBe(false)
  })
})

describe('normalizeWalletAddress', () => {
  it('returns lowercase for a valid mixed-case address', () => {
    const result = normalizeWalletAddress('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')
    expect(result).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  })

  it('trims whitespace before normalizing', () => {
    const result = normalizeWalletAddress('  0xAbCdEf1234567890AbCdEf1234567890AbCdEf12  ')
    expect(result).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  })

  it('returns already-lowercase address unchanged', () => {
    const result = normalizeWalletAddress('0x1234567890abcdef1234567890abcdef12345678')
    expect(result).toBe('0x1234567890abcdef1234567890abcdef12345678')
  })

  it('throws ValidationError for invalid address', () => {
    expect(() => normalizeWalletAddress('invalid')).toThrow('Invalid wallet address format')
  })

  it('throws ValidationError for empty string', () => {
    expect(() => normalizeWalletAddress('')).toThrow('Invalid wallet address format')
  })

  it('throws ValidationError for non-string input', () => {
    expect(() => normalizeWalletAddress(null)).toThrow('Wallet address must be a string')
  })

  it('throws an instance of ValidationError', () => {
    try {
      normalizeWalletAddress('bad')
    } catch (err) {
      expect(err.name).toBe('ValidationError')
    }
  })
})
