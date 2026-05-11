import fp from 'fastify-plugin'
import {
  ValidationError,
  BlockedWalletError,
  WalletNotFoundError,
  SponsorshipNotFoundError,
  RateLimitError,
  InvalidStatusTransitionError,
} from '../lib/errors.js'

/**
 * Error Handler Plugin
 *
 * Centralized Fastify error handler that maps application errors to
 * standardized HTTP responses with the shape: { error, statusCode }.
 *
 * - JSON parse errors → 400 "Invalid JSON in request body"
 * - Schema validation errors → 400 with field-level description
 * - Known error classes → mapped HTTP status codes
 * - Unknown errors → 500 "Internal server error" (logged internally)
 *
 * Production mode: only { error, statusCode } — no additional fields.
 * Development mode: includes errorName but never stack traces or paths.
 *
 * Options:
 *   - isProduction: boolean (defaults to reading from config module)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 14.2, 14.3, 14.5
 */
async function errorHandlerPlugin(fastify, opts) {
  // Determine production mode: use opts if provided, otherwise lazy-load config
  let isProduction
  if (opts && typeof opts.isProduction === 'boolean') {
    isProduction = opts.isProduction
  } else {
    const { config } = await import('../lib/config.js')
    isProduction = config.isProduction
  }

  /**
   * Sends a standardized error response.
   * In production: only { error, statusCode }.
   * In development: adds errorName (but never stack traces or paths).
   */
  function sendError(reply, statusCode, message, errorName) {
    const body = { error: message, statusCode }

    if (!isProduction && errorName) {
      body.errorName = errorName
    }

    return reply.status(statusCode).send(body)
  }

  fastify.setErrorHandler((error, request, reply) => {
    // JSON parse errors — Fastify sets statusCode 400 and a specific message pattern
    if (isJsonParseError(error)) {
      return sendError(reply, 400, 'Invalid JSON in request body')
    }

    // Fastify schema validation errors
    if (error.validation) {
      const message = formatValidationError(error)
      return sendError(reply, 400, message)
    }

    // Known application error classes
    if (error instanceof ValidationError) {
      return sendError(reply, 400, error.message, error.name)
    }

    if (error instanceof BlockedWalletError) {
      return sendError(reply, 403, error.message, error.name)
    }

    if (error instanceof WalletNotFoundError) {
      return sendError(reply, 404, error.message, error.name)
    }

    if (error instanceof SponsorshipNotFoundError) {
      return sendError(reply, 404, error.message, error.name)
    }

    if (error instanceof RateLimitError) {
      if (error.retryAfter) {
        reply.header('Retry-After', error.retryAfter)
      }
      return sendError(reply, 429, error.message, error.name)
    }

    if (error instanceof InvalidStatusTransitionError) {
      return sendError(reply, 400, error.message, error.name)
    }

    // Unknown/unhandled errors — log full details internally, return sanitized response
    request.log.error(error)
    return sendError(reply, 500, 'Internal server error')
  })
}

/**
 * Detects JSON parse errors from Fastify's content-type parser.
 * In Fastify 5, JSON parse errors have code FST_ERR_CTP_INVALID_JSON_BODY
 * or FST_ERR_CTP_EMPTY_JSON_BODY with statusCode 400.
 */
function isJsonParseError(error) {
  if (error.statusCode !== 400) return false
  // Don't treat schema validation errors as JSON parse errors
  if (error.validation) return false

  // Fastify 5 specific error codes for JSON body issues
  if (
    error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
  ) {
    return true
  }

  // Fallback: detect by message content for compatibility
  const msg = (error.message || '').toLowerCase()
  return (
    msg.includes('unexpected token') ||
    msg.includes('unexpected end of json') ||
    (msg.includes('json') && msg.includes('parse')) ||
    msg.includes('invalid json') ||
    (msg.includes('not valid json') && msg.includes('content-type'))
  )
}

/**
 * Formats Fastify schema validation errors into a human-readable message
 * without exposing raw JSON Schema keywords or internal schema structure.
 */
function formatValidationError(error) {
  if (!error.validation || error.validation.length === 0) {
    return 'Request validation failed'
  }

  const parts = error.validation.map((v) => {
    const field = v.instancePath
      ? v.instancePath.replace(/^\//, '').replace(/\//g, '.')
      : v.params?.missingProperty || 'request'

    // Map JSON Schema keywords to human-readable descriptions
    switch (v.keyword) {
      case 'required':
        return `${v.params.missingProperty} is required`
      case 'type':
        return `${field} must be of type ${v.params.type}`
      case 'pattern':
        return `${field} has an invalid format`
      case 'maxLength':
        return `${field} exceeds maximum length`
      case 'minLength':
        return `${field} is too short`
      case 'format':
        return `${field} has an invalid format`
      case 'additionalProperties':
        return `Unknown property: ${v.params.additionalProperty}`
      case 'enum':
        return `${field} has an invalid value`
      case 'minimum':
      case 'maximum':
        return `${field} is out of range`
      default:
        return `${field} is invalid`
    }
  })

  return parts.join('; ')
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
  fastify: '>=4.x',
})

// Export internals for testing
export { errorHandlerPlugin, isJsonParseError, formatValidationError }
