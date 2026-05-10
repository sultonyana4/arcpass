import { describe, it, expect } from 'vitest'
import {
  ValidationError,
  BlockedWalletError,
  WalletNotFoundError,
} from '../src/lib/errors.js'

describe('Custom Error Classes', () => {
  describe('ValidationError', () => {
    it('should be an instance of Error', () => {
      const error = new ValidationError('invalid address')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have name set to ValidationError', () => {
      const error = new ValidationError('invalid address')
      expect(error.name).toBe('ValidationError')
    })

    it('should store the message', () => {
      const error = new ValidationError('invalid address format')
      expect(error.message).toBe('invalid address format')
    })
  })

  describe('BlockedWalletError', () => {
    it('should be an instance of Error', () => {
      const error = new BlockedWalletError('wallet is blocked')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have name set to BlockedWalletError', () => {
      const error = new BlockedWalletError('wallet is blocked')
      expect(error.name).toBe('BlockedWalletError')
    })

    it('should store the message', () => {
      const error = new BlockedWalletError('Wallet is blocked')
      expect(error.message).toBe('Wallet is blocked')
    })
  })

  describe('WalletNotFoundError', () => {
    it('should be an instance of Error', () => {
      const error = new WalletNotFoundError('wallet not found')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have name set to WalletNotFoundError', () => {
      const error = new WalletNotFoundError('wallet not found')
      expect(error.name).toBe('WalletNotFoundError')
    })

    it('should store the message', () => {
      const error = new WalletNotFoundError('Wallet not found')
      expect(error.message).toBe('Wallet not found')
    })
  })
})
