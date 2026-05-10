import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Account, PublicClient, WalletClient } from 'viem'

export interface ViemClients {
  publicClient: PublicClient
  walletClient: WalletClient
  account: Account
}

export class ChainIdMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Chain ID mismatch: expected ${expected} but RPC returned ${actual}. ` +
      `Verify CHAIN_ID and CHAIN_RPC_URL are configured for the same network.`
    )
    this.name = 'ChainIdMismatchError'
  }
}

export class ChainIdVerificationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Chain ID verification timed out after ${timeoutMs}ms. ` +
      `The RPC endpoint may be unreachable. Check CHAIN_RPC_URL.`
    )
    this.name = 'ChainIdVerificationTimeoutError'
  }
}

/**
 * Verifies that the RPC endpoint reports the expected chain ID.
 * Should be called during worker startup to catch misconfiguration early.
 *
 * @param publicClient - viem PublicClient connected to the RPC endpoint
 * @param expectedChainId - The chain ID from the CHAIN_ID env var
 * @param timeoutMs - Maximum time to wait for the RPC response (default 10000ms)
 * @throws ChainIdMismatchError if the RPC returns a different chain ID
 * @throws ChainIdVerificationTimeoutError if the RPC does not respond in time
 */
export async function verifyChainId(
  publicClient: PublicClient,
  expectedChainId: number,
  timeoutMs: number = 10000
): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new ChainIdVerificationTimeoutError(timeoutMs))
    }, timeoutMs)
  })

  let actualChainId: number
  try {
    actualChainId = await Promise.race([
      publicClient.getChainId(),
      timeoutPromise,
    ])
  } catch (error) {
    if (error instanceof ChainIdVerificationTimeoutError) {
      throw error
    }
    // Wrap unexpected RPC errors with context
    throw new Error(
      `Chain ID verification failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (actualChainId !== expectedChainId) {
    throw new ChainIdMismatchError(expectedChainId, actualChainId)
  }
}

/**
 * Validates the sponsor private key by attempting to derive a secp256k1 account.
 *
 * - Normalizes the key to include 0x prefix if not already present.
 * - Uses viem's `privateKeyToAccount` which throws if the key does not produce
 *   a valid secp256k1 curve point.
 * - On failure: logs an error message without exposing key material and
 *   terminates the process with exit code 1.
 * - On success: returns the derived Account for use with wallet clients.
 *
 * Call this function during worker startup before processing any requests.
 */
export function validateSponsorPrivateKey(sponsorPrivateKey: string): Account {
  const normalizedKey = sponsorPrivateKey.startsWith('0x')
    ? (sponsorPrivateKey as `0x${string}`)
    : (`0x${sponsorPrivateKey}` as `0x${string}`)

  try {
    const account = privateKeyToAccount(normalizedKey)
    return account
  } catch {
    console.error(
      'Invalid sponsor private key: failed cryptographic validation'
    )
    process.exit(1)
  }
}

/**
 * Creates configured viem public and wallet clients from the provided config.
 *
 * - Uses http transport for simplicity and broad RPC provider compatibility.
 * - Does not hardcode a chain definition — relies on the RPC's reported chain ID.
 * - Validates the private key cryptographically via `validateSponsorPrivateKey`.
 * - Normalizes the private key to include 0x prefix if not already present.
 */
export function createViemClients(config: {
  chainRpcUrl: string
  sponsorPrivateKey: string
}): ViemClients {
  // Validate the private key produces a valid secp256k1 curve point
  const account = validateSponsorPrivateKey(config.sponsorPrivateKey)

  const transport = http(config.chainRpcUrl)

  const publicClient = createPublicClient({
    transport,
  })

  const walletClient = createWalletClient({
    account,
    transport,
  })

  return { publicClient, walletClient, account }
}
