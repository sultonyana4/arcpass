import { describe, it, expect, vi } from 'vitest'
import type { PublicClient } from 'viem'
import {
  verifyChainId,
  validateSponsorPrivateKey,
  ChainIdMismatchError,
  ChainIdVerificationTimeoutError,
} from '../../src/viem-client.js'

function createMockPublicClient(chainId: number, delay = 0): PublicClient {
  return {
    getChainId: vi.fn(() =>
      delay > 0
        ? new Promise<number>((resolve) => setTimeout(() => resolve(chainId), delay))
        : Promise.resolve(chainId)
    ),
  } as unknown as PublicClient
}

function createFailingPublicClient(error: Error): PublicClient {
  return {
    getChainId: vi.fn(() => Promise.reject(error)),
  } as unknown as PublicClient
}

describe('verifyChainId', () => {
  it('resolves when chain ID matches', async () => {
    const client = createMockPublicClient(1337)
    await expect(verifyChainId(client, 1337)).resolves.toBeUndefined()
  })

  it('throws ChainIdMismatchError when chain IDs differ', async () => {
    const client = createMockPublicClient(1)
    await expect(verifyChainId(client, 1337)).rejects.toThrow(ChainIdMismatchError)
  })

  it('includes expected and actual chain IDs in mismatch error message', async () => {
    const client = createMockPublicClient(42161)
    await expect(verifyChainId(client, 1337)).rejects.toThrow(
      'Chain ID mismatch: expected 1337 but RPC returned 42161'
    )
  })

  it('throws ChainIdVerificationTimeoutError when RPC is too slow', async () => {
    const client = createMockPublicClient(1337, 500)
    await expect(verifyChainId(client, 1337, 50)).rejects.toThrow(
      ChainIdVerificationTimeoutError
    )
  })

  it('includes timeout duration in timeout error message', async () => {
    const client = createMockPublicClient(1337, 500)
    await expect(verifyChainId(client, 1337, 100)).rejects.toThrow(
      'Chain ID verification timed out after 100ms'
    )
  })

  it('wraps unexpected RPC errors with context', async () => {
    const client = createFailingPublicClient(new Error('ECONNREFUSED'))
    await expect(verifyChainId(client, 1337)).rejects.toThrow(
      'Chain ID verification failed: ECONNREFUSED'
    )
  })

  it('uses default timeout of 10000ms', async () => {
    const client = createMockPublicClient(1337)
    // Should resolve quickly without hitting the default 10s timeout
    await expect(verifyChainId(client, 1337)).resolves.toBeUndefined()
  })

  it('succeeds when RPC responds within timeout', async () => {
    const client = createMockPublicClient(1337, 20)
    await expect(verifyChainId(client, 1337, 200)).resolves.toBeUndefined()
  })
})


describe('validateSponsorPrivateKey', () => {
  it('returns an account for a valid private key (with 0x prefix)', () => {
    // Known valid private key (test key only, never use in production)
    const validKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const account = validateSponsorPrivateKey(validKey)
    expect(account).toBeDefined()
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('returns an account for a valid private key (without 0x prefix)', () => {
    const validKey = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const account = validateSponsorPrivateKey(validKey)
    expect(account).toBeDefined()
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('terminates process with exit code 1 for an invalid key', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => validateSponsorPrivateKey('invalid-key')).toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)

    mockExit.mockRestore()
    mockConsoleError.mockRestore()
  })

  it('logs error message without exposing key material on failure', () => {
    const invalidKey = '0xdeadbeef_not_a_valid_secp256k1_key_at_all_1234567890abcdef1234567890'
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      validateSponsorPrivateKey(invalidKey)
    } catch {
      // Expected: process.exit mock throws
    }

    expect(mockConsoleError).toHaveBeenCalledWith(
      'Invalid sponsor private key: failed cryptographic validation'
    )
    // Ensure the key material is NOT in the error message
    const errorCall = mockConsoleError.mock.calls[0][0] as string
    expect(errorCall).not.toContain(invalidKey)
    expect(errorCall).not.toContain('deadbeef')

    mockExit.mockRestore()
    mockConsoleError.mockRestore()
  })

  it('terminates for a key that is all zeros (invalid curve point)', () => {
    const zeroKey = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => validateSponsorPrivateKey(zeroKey)).toThrow('process.exit called')
    expect(mockExit).toHaveBeenCalledWith(1)

    mockExit.mockRestore()
    mockConsoleError.mockRestore()
  })
})
