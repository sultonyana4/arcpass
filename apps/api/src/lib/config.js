const VALID_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']

const rawPort = process.env.PORT ?? '4000'
const rawLogLevel = process.env.LOG_LEVEL ?? 'info'

const port = Number(rawPort)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(
    `Invalid PORT: ${rawPort}. Must be an integer between 1 and 65535.`
  )
}

if (!VALID_LOG_LEVELS.includes(rawLogLevel)) {
  throw new Error(
    `Invalid LOG_LEVEL: ${rawLogLevel}. Must be one of: fatal, error, warn, info, debug, trace.`
  )
}

export const config = Object.freeze({
  port,
  logLevel: rawLogLevel,
})
