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
}

export function loadConfig(): WorkerConfig {
  // Validate all required environment variables first
  const databaseUrl = requireEnv('DATABASE_URL')
  const chainRpcUrl = requireEnv('CHAIN_RPC_URL')
  const sponsorPrivateKey = requireEnv('SPONSOR_PRIVATE_KEY')

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
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return value
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

function validateRange(name: string, value: number, min: number, max: number): void {
  if (value < min || value > max) {
    console.error(
      `Invalid environment variable: ${name} must be between ${min} and ${max}, got ${value}`
    )
    process.exit(1)
  }
}
