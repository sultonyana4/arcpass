/**
 * Structured JSON logger for the ArcPass worker.
 * Outputs single-line JSON with component tagging and sensitive data filtering.
 */

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  component: 'relay-executor' | 'processor' | 'worker' | 'poller' | 'contract-client' | 'lifecycle'
  message: string
  [key: string]: unknown
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

/**
 * Patterns that identify sensitive field keys.
 * Any field whose key matches one of these (case-insensitive) will be stripped.
 */
const SENSITIVE_KEY_PATTERNS = [
  /privatekey/i,
  /private_key/i,
  /mnemonic/i,
  /secret/i,
  /password/i,
  /credential/i,
  /authorization/i,
]

/**
 * Detects credential-bearing URLs (user:pass@host pattern).
 */
const CREDENTIAL_URL_PATTERN = /^https?:\/\/[^:]+:[^@]+@/i

/**
 * Checks if a field key matches any sensitive pattern.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/**
 * Checks if a string value is a credential-bearing URL.
 */
function isCredentialUrl(value: unknown): boolean {
  return typeof value === 'string' && CREDENTIAL_URL_PATTERN.test(value)
}

/**
 * Recursively strips sensitive fields from a data object.
 * Returns a new object with sensitive fields replaced by '[REDACTED]'.
 */
function filterSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      filtered[key] = '[REDACTED]'
    } else if (isCredentialUrl(value)) {
      filtered[key] = '[REDACTED_URL]'
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      filtered[key] = filterSensitiveData(value as Record<string, unknown>)
    } else {
      filtered[key] = value
    }
  }

  return filtered
}

/**
 * Creates a structured logger for a specific component.
 * All log output is single-line JSON written to stdout/stderr.
 */
export function createLogger(component: LogEntry['component']): Logger {
  function log(level: LogEntry['level'], message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...(data ? filterSensitiveData(data) : {}),
    }

    const output = JSON.stringify(entry)

    if (level === 'error') {
      process.stderr.write(output + '\n')
    } else {
      process.stdout.write(output + '\n')
    }
  }

  return {
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error: (message, data) => log('error', message, data),
  }
}
