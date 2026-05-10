import { describe, it, expect } from 'vitest'
import { simulateRelay } from '../../src/relay-simulator.js'

describe('relay-simulator', () => {
  describe('input validation', () => {
    it('throws on undefined sponsorship request ID', async () => {
      await expect(simulateRelay(undefined as unknown as string)).rejects.toThrow(
        'A valid sponsorship request ID is required'
      )
    })

    it('throws on empty string sponsorship request ID', async () => {
      await expect(simulateRelay('')).rejects.toThrow(
        'A valid sponsorship request ID is required'
      )
    })

    it('throws on whitespace-only sponsorship request ID', async () => {
      await expect(simulateRelay('   ')).rejects.toThrow(
        'A valid sponsorship request ID is required'
      )
    })
  })

  describe('transaction hash format', () => {
    it('returns hash matching 0x followed by 64 hex chars on success', async () => {
      const result = await simulateRelay('test-request-id')
      expect(result.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('first 8 hex chars are derived deterministically from request ID', async () => {
      const result1 = await simulateRelay('same-request-id')
      const result2 = await simulateRelay('same-request-id')

      const prefix1 = result1.transactionHash!.slice(2, 10)
      const prefix2 = result2.transactionHash!.slice(2, 10)

      expect(prefix1).toBe(prefix2)
    })

    it('different request IDs produce different prefixes', async () => {
      const result1 = await simulateRelay('request-a')
      const result2 = await simulateRelay('request-b')

      const prefix1 = result1.transactionHash!.slice(2, 10)
      const prefix2 = result2.transactionHash!.slice(2, 10)

      expect(prefix1).not.toBe(prefix2)
    })
  })

  describe('failure rate behavior', () => {
    it('failure rate 0.0 always succeeds', async () => {
      for (let i = 0; i < 20; i++) {
        const result = await simulateRelay(`request-${i}`, 0.0)
        expect(result.success).toBe(true)
        expect(result.transactionHash).not.toBeNull()
        expect(result.failureReason).toBeNull()
      }
    })

    it('failure rate 1.0 always fails', async () => {
      for (let i = 0; i < 20; i++) {
        const result = await simulateRelay(`request-${i}`, 1.0)
        expect(result.success).toBe(false)
        expect(result.transactionHash).toBeNull()
        expect(result.failureReason).not.toBeNull()
      }
    })

    it('default failure rate (no argument) always succeeds', async () => {
      for (let i = 0; i < 20; i++) {
        const result = await simulateRelay(`request-${i}`)
        expect(result.success).toBe(true)
      }
    })
  })

  describe('result structure', () => {
    it('success result has transactionHash and null failureReason', async () => {
      const result = await simulateRelay('test-id', 0.0)
      expect(result.success).toBe(true)
      expect(result.transactionHash).toBeTypeOf('string')
      expect(result.failureReason).toBeNull()
    })

    it('failure result has failureReason and null transactionHash', async () => {
      const result = await simulateRelay('test-id', 1.0)
      expect(result.success).toBe(false)
      expect(result.failureReason).toBeTypeOf('string')
      expect(result.transactionHash).toBeNull()
    })

    it('failureReason is between 1 and 500 chars', async () => {
      const result = await simulateRelay('test-id', 1.0)
      expect(result.failureReason!.length).toBeGreaterThanOrEqual(1)
      expect(result.failureReason!.length).toBeLessThanOrEqual(500)
    })
  })

  describe('performance', () => {
    it('completes within 100ms', async () => {
      const start = performance.now()
      await simulateRelay('perf-test-id')
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(100)
    })
  })
})
