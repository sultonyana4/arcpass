import 'dotenv/config'

/**
 * Resolve environment variable with fallback alias for backward compatibility.
 * Supports legacy variable names (ARC_RPC_URL, DEPLOYER_PRIVATE_KEY) as fallbacks
 * for the canonical names (CHAIN_RPC_URL, SPONSOR_PRIVATE_KEY).
 */
function resolveEnv(canonical: string, fallback?: string): string | undefined {
  const value = process.env[canonical]
  if (value && value.trim() !== '') return value
  if (fallback) {
    const fallbackValue = process.env[fallback]
    if (fallbackValue && fallbackValue.trim() !== '') {
      // Promote fallback into canonical so downstream checks see it
      process.env[canonical] = fallbackValue
      return fallbackValue
    }
  }
  return value
}

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

  // 0. Resolve backward-compatible aliases before validation
  // ARC_RPC_URL → CHAIN_RPC_URL, DEPLOYER_PRIVATE_KEY → SPONSOR_PRIVATE_KEY
  resolveEnv('CHAIN_RPC_URL', 'ARC_RPC_URL')
  resolveEnv('SPONSOR_PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY')

  // 1. Check all required environment variables are present (non-empty after trimming)
  const requiredVars = [
    'DATABASE_URL',
    'CHAIN_RPC_URL',
    'SPONSOR_PRIVATE_KEY',
    'CHAIN_ID',
    'CONTRACT_ADDRESS_SPONSOR_VAULT',
    'CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY',
  ] as const

  const missing = requiredVars.filter(
    (name) => !process.env[name] || process.env[name]!.trim() === ''
  )
  if (missing.length > 0) {
    errors.push(...missing)
  }

  // 2. Format validation for present required variables
  const chainRpcUrl = (process.env.CHAIN_RPC_URL ?? '').trim()
  const sponsorPrivateKey = (process.env.SPONSOR_PRIVATE_KEY ?? '').trim()
  const chainIdRaw = (process.env.CHAIN_ID ?? '').trim()
  const contractAddressSponsorVault = (process.env.CONTRACT_ADDRESS_SPONSOR_VAULT ?? '').trim()
  const contractAddressSponsorshipRegistry = (process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY ?? '').trim()

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
    // Only log variable names — never log sensitive values (Requirement 14.4)
    process.stderr.write(
      `Invalid or missing environment variables: ${uniqueErrors.join(', ')}\n`
    )
    process.exit(1)
  }

  // Parse optional explorer base URL with trailing slash normalization
  const explorerBaseUrl = normalizeTrailingSlash(
    process.env.EXPLORER_BASE_URL || 'https://testnet.arcscan.app/tx/'
  )

  // Return frozen config object to prevent accidental mutation (Requirement 8.8)
  return Object.freeze({
    databaseUrl: process.env.DATABASE_URL!.trim(),
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
  })
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
