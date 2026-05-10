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
  explorerBaseUrl: string
}

const CONTRACT_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

export function loadConfig(): WorkerConfig {
  const errors: string[] = []

  // 1. Check all required environment variables are present
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
    errors.push(...missing)
  }

  // 2. Format validation for present required variables
  const chainRpcUrl = process.env.CHAIN_RPC_URL ?? ''
  const sponsorPrivateKey = process.env.SPONSOR_PRIVATE_KEY ?? ''
  const chainIdRaw = process.env.CHAIN_ID ?? ''
  const contractAddressSponsorVault = process.env.CONTRACT_ADDRESS_SPONSOR_VAULT ?? ''
  const contractAddressSponsorshipRegistry = process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY ?? ''

  // Only validate format if the variable is present (missing is already reported)
  if (chainRpcUrl && !chainRpcUrl.startsWith('http://') && !chainRpcUrl.startsWith('https://')) {
    errors.push('CHAIN_RPC_URL')
  }

  if (sponsorPrivateKey) {
    const keyWithoutPrefix = sponsorPrivateKey.startsWith('0x')
      ? sponsorPrivateKey.slice(2)
      : sponsorPrivateKey
    if (!/^[0-9a-fA-F]{64}$/.test(keyWithoutPrefix)) {
      errors.push('SPONSOR_PRIVATE_KEY')
    }
  }

  if (chainIdRaw) {
    const chainIdNum = Number(chainIdRaw)
    if (!Number.isInteger(chainIdNum) || chainIdNum <= 0) {
      errors.push('CHAIN_ID')
    }
  }

  if (contractAddressSponsorVault && !CONTRACT_ADDRESS_PATTERN.test(contractAddressSponsorVault)) {
    errors.push('CONTRACT_ADDRESS_SPONSOR_VAULT')
  }

  if (contractAddressSponsorshipRegistry && !CONTRACT_ADDRESS_PATTERN.test(contractAddressSponsorshipRegistry)) {
    errors.push('CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY')
  }

  // 3. Validate optional numeric environment variables (collect errors)
  const pollIntervalMs = parseNumericEnvCollect('POLL_INTERVAL_MS', 5000, errors)
  validateRangeCollect('POLL_INTERVAL_MS', pollIntervalMs, 1000, 60000, errors)

  const batchSize = parseNumericEnvCollect('BATCH_SIZE', 20, errors)
  validateRangeCollect('BATCH_SIZE', batchSize, 1, 100, errors)

  const maxRetries = parseNumericEnvCollect('MAX_RETRIES', 5, errors)
  validateRangeCollect('MAX_RETRIES', maxRetries, 1, 10, errors)

  const lockTimeoutMs = parseNumericEnvCollect('LOCK_TIMEOUT_MS', 30000, errors)
  validateRangeCollect('LOCK_TIMEOUT_MS', lockTimeoutMs, 5000, 120000, errors)

  const shutdownTimeoutMs = parseNumericEnvCollect('SHUTDOWN_TIMEOUT_MS', 10000, errors)
  validateRangeCollect('SHUTDOWN_TIMEOUT_MS', shutdownTimeoutMs, 5000, 60000, errors)

  const confirmationBlocks = parseNumericEnvCollect('CONFIRMATION_BLOCKS', 2, errors)
  validateRangeCollect('CONFIRMATION_BLOCKS', confirmationBlocks, 1, 50, errors)

  const txTimeoutMs = parseNumericEnvCollect('TX_TIMEOUT_MS', 120000, errors)
  validateRangeCollect('TX_TIMEOUT_MS', txTimeoutMs, 10000, 600000, errors)

  const sponsorshipAmount = parseBigIntEnvCollect('SPONSORSHIP_AMOUNT_WEI', 1000000000000000n, errors)

  const chainIdVerifyTimeoutMs = parseNumericEnvCollect('CHAIN_ID_VERIFY_TIMEOUT_MS', 10000, errors)
  validateRangeCollect('CHAIN_ID_VERIFY_TIMEOUT_MS', chainIdVerifyTimeoutMs, 1000, 30000, errors)

  // 4. Report all errors at once and terminate
  // Deduplicate errors (a variable could appear in both missing and format checks)
  const uniqueErrors = [...new Set(errors)]
  if (uniqueErrors.length > 0) {
    console.error(
      `Invalid or missing environment variables: ${uniqueErrors.join(', ')}`
    )
    process.exit(1)
  }

  // Parse optional explorer base URL with trailing slash normalization
  const explorerBaseUrl = normalizeTrailingSlash(
    process.env.EXPLORER_BASE_URL || 'https://testnet.arcscan.io/tx/'
  )

  return {
    databaseUrl: process.env.DATABASE_URL!,
    chainRpcUrl,
    sponsorPrivateKey,
    pollIntervalMs,
    batchSize,
    maxRetries,
    lockTimeoutMs,
    shutdownTimeoutMs,
    confirmationBlocks,
    txTimeoutMs,
    chainId: Number(chainIdRaw),
    contractAddressSponsorVault: contractAddressSponsorVault as `0x${string}`,
    contractAddressSponsorshipRegistry: contractAddressSponsorshipRegistry as `0x${string}`,
    sponsorshipAmount,
    chainIdVerifyTimeoutMs,
    explorerBaseUrl,
  }
}

function parseNumericEnvCollect(name: string, defaultValue: number, errors: string[]): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return defaultValue
  }

  const parsed = Number(raw)
  if (Number.isNaN(parsed)) {
    errors.push(name)
    return defaultValue
  }

  return parsed
}

function parseBigIntEnvCollect(name: string, defaultValue: bigint, errors: string[]): bigint {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return defaultValue
  }

  try {
    const parsed = BigInt(raw)
    if (parsed <= 0n) {
      errors.push(name)
      return defaultValue
    }
    return parsed
  } catch {
    errors.push(name)
    return defaultValue
  }
}

function validateRangeCollect(name: string, value: number, min: number, max: number, errors: string[]): void {
  // Only validate range if the env var was explicitly set (not using default)
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return
  }
  if (value < min || value > max) {
    errors.push(name)
  }
}

export function normalizeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : url + '/'
}
