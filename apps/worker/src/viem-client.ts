import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Account, PublicClient, WalletClient } from 'viem'

export interface ViemClients {
  publicClient: PublicClient
  walletClient: WalletClient
  account: Account
}

/**
 * Creates configured viem public and wallet clients from the provided config.
 *
 * - Uses http transport for simplicity and broad RPC provider compatibility.
 * - Does not hardcode a chain definition — relies on the RPC's reported chain ID.
 * - Derives the account from the private key using privateKeyToAccount, which
 *   throws on invalid curve point (serves as cryptographic validation).
 * - Normalizes the private key to include 0x prefix if not already present.
 */
export function createViemClients(config: {
  chainRpcUrl: string
  sponsorPrivateKey: string
}): ViemClients {
  const normalizedKey = config.sponsorPrivateKey.startsWith('0x')
    ? (config.sponsorPrivateKey as `0x${string}`)
    : (`0x${config.sponsorPrivateKey}` as `0x${string}`)

  // privateKeyToAccount throws on invalid secp256k1 curve point
  const account = privateKeyToAccount(normalizedKey)

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
