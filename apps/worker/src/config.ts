import 'dotenv/config'

export interface WorkerConfig {
  databaseUrl: string
  pollIntervalMs: number
  batchSize: number
  maxRetries: number
  relayFailureRate: number
  lockTimeoutMs: number
  shutdownTimeoutMs: number
}

export function loadConfig(): WorkerConfig {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('Missing required environment variable: DATABASE_URL')
  }

  const pollIntervalMs = parseNumericEnv('POLL_INTERVAL_MS', 5000)
  validateRange('POLL_INTERVAL_MS', pollIntervalMs, 1000, 60000)

  const batchSize = parseNumericEnv('BATCH_SIZE', 20)
  validateRange('BATCH_SIZE', batchSize, 1, 100)

  const maxRetries = parseNumericEnv('MAX_RETRIES', 5)

  const relayFailureRate = parseNumericEnv('RELAY_FAILURE_RATE', 0.0)
  validateRange('RELAY_FAILURE_RATE', relayFailureRate, 0.0, 1.0)

  const lockTimeoutMs = parseNumericEnv('LOCK_TIMEOUT_MS', 30000)

  const shutdownTimeoutMs = parseNumericEnv('SHUTDOWN_TIMEOUT_MS', 10000)

  return {
    databaseUrl,
    pollIntervalMs,
    batchSize,
    maxRetries,
    relayFailureRate,
    lockTimeoutMs,
    shutdownTimeoutMs,
  }
}

function parseNumericEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return defaultValue
  }

  const parsed = Number(raw)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid environment variable: ${name} must be a valid number`)
  }

  return parsed
}

function validateRange(name: string, value: number, min: number, max: number): void {
  if (value < min || value > max) {
    throw new Error(
      `Invalid environment variable: ${name} must be between ${min} and ${max}, got ${value}`
    )
  }
}
