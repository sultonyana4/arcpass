import 'dotenv/config'

export interface WorkerConfig {
  databaseUrl: string
  chainRpcUrl: string
  sponsorPrivateKey: string
  pollIntervalMs: number
  batchSize: number
  maxRetries: number
  lockTimeoutMs: number
  shutdownTimeoutMs: number
  confirmationBlocks: number
  txTimeoutMs: number

  // New fields for MVP
  chainId: number
  contractAddressSponsorVault: `0x${string}`
  contractAddressSponsorshipRegistry: `0x${string}`
  sponsorshipAmount: bigint
  chainIdVerifyTimeoutMs: number
}

const CONTRACT_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

export function loadConfig(): WorkerConfig {
  // Collect all missing required environment variables
  const requiredVars = [
    'DATABASE_URL',
    'CHAIN_RPC_URL',
    'SPONSOR_PRIVATE_KEY',
    'CHAIN_ID',
    'CONTRACT_ADDRESS_SPONSOR_VAULT',
    'CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY',
  ] as const

  const missing = requiredVars.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  const databaseUrl = process.env.DATABASE_URL!
  const chainRpcUrl = process.env.CHAIN_RPC_URL!
  const sponsorPrivateKey = process.env.SPONSOR_PRIVATE_KEY!
  const chainIdRaw = process.env.CHAIN_ID!
  const contractAddressSponsorVault = process.env.CONTRACT_ADDRESS_SPONSOR_VAULT!
  const contractAddressSponsorshipRegistry = process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY!

  // Format validation for chainRpcUrl
  if (!chainRpcUrl.startsWith('http://') && !chainRpcUrl.startsWith('https://')) {
    console.error(
      'Invalid environment variable: CHAIN_RPC_URL must start with http:// or https://'
    )
    process.exit(1)
  }

  // Format validation for sponsorPrivateKey (64-char hex, optional 0x prefix)
  const keyWithoutPrefix = sponsorPrivateKey.startsWith('0x')
    ? sponsorPrivateKey.slice(2)
    : sponsorPrivateKey
  if (!/^[0-9a-fA-F]{64}$/.test(keyWithoutPrefix)) {
    console.error(
      'Invalid environment variable: SPONSOR_PRIVATE_KEY must be a 64-character hexadecimal string (with or without 0x prefix)'
    )
    process.exit(1)
  }

  // Validate CHAIN_ID is a positive integer
  const chainId = Number(chainIdRaw)
  if (!Number.isInteger(chainId) || chainId <= 0) {
    console.error(
      'Invalid environment variable: CHAIN_ID must be a positive integer'
    )
    process.exit(1)
  }

  // Validate contract address formats
  if (!CONTRACT_ADDRESS_PATTERN.test(contractAddressSponsorVault)) {
    console.error(
      'Invalid environment variable: CONTRACT_ADDRESS_SPONSOR_VAULT must be a 42-character hex address (0x followed by 40 hex characters)'
    )
    process.exit(1)
  }

  if (!CONTRACT_ADDRESS_PATTERN.test(contractAddressSponsorshipRegistry)) {
    console.error(
      'Invalid environment variable: CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY must be a 42-character hex address (0x followed by 40 hex characters)'
    )
    process.exit(1)
  }

  // Parse and validate optional numeric environment variables
  const pollIntervalMs = parseNumericEnv('POLL_INTERVAL_MS', 5000)
  validateRange('POLL_INTERVAL_MS', pollIntervalMs, 1000, 60000)

  const batchSize = parseNumericEnv('BATCH_SIZE', 20)
  validateRange('BATCH_SIZE', batchSize, 1, 100)

  const maxRetries = parseNumericEnv('MAX_RETRIES', 5)
  validateRange('MAX_RETRIES', maxRetries, 1, 10)

  const lockTimeoutMs = parseNumericEnv('LOCK_TIMEOUT_MS', 30000)
  validateRange('LOCK_TIMEOUT_MS', lockTimeoutMs, 5000, 120000)

  const shutdownTimeoutMs = parseNumericEnv('SHUTDOWN_TIMEOUT_MS', 10000)
  validateRange('SHUTDOWN_TIMEOUT_MS', shutdownTimeoutMs, 5000, 60000)

  const confirmationBlocks = parseNumericEnv('CONFIRMATION_BLOCKS', 2)
  validateRange('CONFIRMATION_BLOCKS', confirmationBlocks, 1, 50)

  const txTimeoutMs = parseNumericEnv('TX_TIMEOUT_MS', 120000)
  validateRange('TX_TIMEOUT_MS', txTimeoutMs, 10000, 600000)

  // Parse optional sponsorship amount (defaults to 0.001 ETH in wei)
  const sponsorshipAmount = parseBigIntEnv('SPONSORSHIP_AMOUNT_WEI', 1000000000000000n)

  // Parse optional chain ID verify timeout
  const chainIdVerifyTimeoutMs = parseNumericEnv('CHAIN_ID_VERIFY_TIMEOUT_MS', 10000)
  validateRange('CHAIN_ID_VERIFY_TIMEOUT_MS', chainIdVerifyTimeoutMs, 1000, 30000)

  return {
    databaseUrl,
    chainRpcUrl,
    sponsorPrivateKey,
    pollIntervalMs,
    batchSize,
    maxRetries,
    lockTimeoutMs,
    shutdownTimeoutMs,
    confirmationBlocks,
    txTimeoutMs,
    chainId,
    contractAddressSponsorVault: contractAddressSponsorVault as `0x${string}`,
    contractAddressSponsorshipRegistry: contractAddressSponsorshipRegistry as `0x${string}`,
    sponsorshipAmount,
    chainIdVerifyTimeoutMs,
  }
}

function parseNumericEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return defaultValue
  }

  const parsed = Number(raw)
  if (Number.isNaN(parsed)) {
    console.error(`Invalid environment variable: ${name} must be a valid number, got "${raw}"`)
    process.exit(1)
  }

  return parsed
}

function parseBigIntEnv(name: string, defaultValue: bigint): bigint {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return defaultValue
  }

  try {
    const parsed = BigInt(raw)
    if (parsed <= 0n) {
      console.error(`Invalid environment variable: ${name} must be a positive integer, got "${raw}"`)
      process.exit(1)
    }
    return parsed
  } catch {
    console.error(`Invalid environment variable: ${name} must be a valid integer, got "${raw}"`)
    process.exit(1)
  }
}

function validateRange(name: string, value: number, min: number, max: number): void {
  if (value < min || value > max) {
    console.error(
      `Invalid environment variable: ${name} must be between ${min} and ${max}, got ${value}`
    )
    process.exit(1)
  }
}
