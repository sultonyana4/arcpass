/**
 * API Config Loader with aggregated validation.
 *
 * Validates all required environment variables at startup.
 * Collects all failures and reports them in a single error message.
 * Never logs sensitive values (only variable names).
 * Exports a frozen config object.
 */

const VALID_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']

/**
 * Loads and validates all API configuration from environment variables.
 * Collects all validation errors and reports them together.
 * Terminates with exit code 1 if any validation fails.
 *
 * @returns {Readonly<object>} Frozen config object
 */
export function loadConfig() {
  const errors = []

  // --- Required: DATABASE_URL ---
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) {
    errors.push('DATABASE_URL: must be present and non-empty')
  } else if (
    !databaseUrl.startsWith('postgresql://') &&
    !databaseUrl.startsWith('postgres://')
  ) {
    errors.push('DATABASE_URL: must start with postgresql:// or postgres://')
  }

  // --- Optional with default: PORT ---
  const rawPort = process.env.PORT
  let port = 4000
  if (rawPort !== undefined && rawPort !== '') {
    const parsed = Number(rawPort)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      errors.push('PORT: must be an integer between 1 and 65535')
    } else {
      port = parsed
    }
  }

  // --- Optional with default: LOG_LEVEL ---
  const rawLogLevel = process.env.LOG_LEVEL
  let logLevel = 'info'
  if (rawLogLevel !== undefined && rawLogLevel !== '') {
    if (!VALID_LOG_LEVELS.includes(rawLogLevel)) {
      errors.push(
        `LOG_LEVEL: must be one of ${VALID_LOG_LEVELS.join(', ')}`
      )
    } else {
      logLevel = rawLogLevel
    }
  }

  // --- Optional: CORS_ALLOWED_ORIGINS (comma-separated, trimmed) ---
  const rawCorsOrigins = process.env.CORS_ALLOWED_ORIGINS ?? ''
  const corsAllowedOrigins = rawCorsOrigins
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // --- NODE_ENV ---
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  const isProduction = nodeEnv === 'production'

  // --- Rate limit config ---
  const rateLimitIpMax = parsePositiveInt(
    'RATE_LIMIT_IP_MAX',
    10,
    errors
  )
  const rateLimitWindowMs = parsePositiveInt(
    'RATE_LIMIT_WINDOW_MS',
    3600000,
    errors
  )
  const rateLimitBlockDurationMs = parsePositiveInt(
    'RATE_LIMIT_BLOCK_DURATION_MS',
    900000,
    errors
  )
  const rateLimitWalletMax = parsePositiveInt(
    'RATE_LIMIT_WALLET_MAX',
    5,
    errors
  )

  // --- Report all errors and exit ---
  if (errors.length > 0) {
    process.stderr.write(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`
    )
    process.exit(1)
  }

  return Object.freeze({
    port,
    logLevel,
    databaseUrl,
    corsAllowedOrigins,
    nodeEnv,
    isProduction,
    rateLimitIpMax,
    rateLimitWindowMs,
    rateLimitBlockDurationMs,
    rateLimitWalletMax,
  })
}

/**
 * Parses an environment variable as a positive integer.
 * Returns the default if the variable is not set or empty.
 * Pushes an error message if the value is invalid.
 *
 * @param {string} name - Environment variable name
 * @param {number} defaultValue - Default value if not set
 * @param {string[]} errors - Error accumulator array
 * @returns {number}
 */
function parsePositiveInt(name, defaultValue, errors) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return defaultValue
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    errors.push(`${name}: must be a positive integer`)
    return defaultValue
  }
  return parsed
}

// Load config at module import time (fail-fast on startup)
export const config = loadConfig()
