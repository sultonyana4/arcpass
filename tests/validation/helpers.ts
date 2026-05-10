/**
 * Shared test utilities for the ArcPass runtime validation suite.
 *
 * Provides availability checks, polling helpers, and environment validation
 * utilities used across all validation test files.
 */

import {
  API_BASE_URL,
  CHAIN_RPC_URL,
  DATABASE_URL,
  DB_CONNECTION_TIMEOUT_MS,
  API_HEALTH_TIMEOUT_MS,
  CHAIN_ID_VERIFY_TIMEOUT_MS,
} from './constants.js'

// ─── Availability Checks ─────────────────────────────────────────────────────

/**
 * Check if the PostgreSQL database is reachable by attempting a TCP connection.
 * Parses the DATABASE_URL to extract host and port, then verifies connectivity.
 */
export async function isDatabaseReachable(): Promise<boolean> {
  if (!DATABASE_URL) return false

  try {
    const url = new URL(DATABASE_URL)
    const host = url.hostname
    const port = Number(url.port) || 5432

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DB_CONNECTION_TIMEOUT_MS)

    try {
      const response = await fetch(`http://${host}:${port}`, {
        signal: controller.signal,
      }).catch(() => null)

      // PostgreSQL won't respond to HTTP, but if we get a connection error
      // vs a timeout/refused, we can distinguish reachability.
      // A more reliable check: use the pg driver or Prisma.
      // For validation purposes, we try a raw TCP approach via net.
      clearTimeout(timeout)

      // Fallback: try connecting via a simple query using the pg protocol
      // We'll use dynamic import to avoid hard dependency
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient({
        datasources: { db: { url: DATABASE_URL } },
      })

      await prisma.$queryRaw`SELECT 1`
      await prisma.$disconnect()
      return true
    } catch {
      clearTimeout(timeout)
      return false
    }
  } catch {
    return false
  }
}

/**
 * Check if the API server is reachable by hitting the /health endpoint.
 */
export async function isApiReachable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), API_HEALTH_TIMEOUT_MS)

    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return response.ok
    } catch {
      clearTimeout(timeout)
      return false
    }
  } catch {
    return false
  }
}

/**
 * Check if the RPC endpoint is reachable by sending a simple JSON-RPC request.
 */
export async function isRpcReachable(): Promise<boolean> {
  if (!CHAIN_RPC_URL) return false

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CHAIN_ID_VERIFY_TIMEOUT_MS)

    try {
      const response = await fetch(CHAIN_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return response.ok
    } catch {
      clearTimeout(timeout)
      return false
    }
  } catch {
    return false
  }
}

// ─── Polling Helper ──────────────────────────────────────────────────────────

export interface PollOptions<T> {
  /** Function to execute on each poll iteration */
  fn: () => Promise<T>
  /** Predicate that returns true when polling should stop */
  until: (result: T) => boolean
  /** Interval between polls in milliseconds (default: 2000) */
  intervalMs?: number
  /** Maximum time to poll before timing out in milliseconds (default: 30000) */
  timeoutMs?: number
  /** Optional description for error messages */
  description?: string
}

export interface PollResult<T> {
  /** Whether polling completed successfully (predicate returned true) */
  success: boolean
  /** The last result from the polling function */
  result: T | undefined
  /** Number of attempts made */
  attempts: number
  /** Total elapsed time in milliseconds */
  elapsedMs: number
}

/**
 * Poll a function at a configurable interval until a predicate is satisfied or timeout.
 *
 * @example
 * ```ts
 * const result = await poll({
 *   fn: () => fetch(`/sponsorship/${id}`).then(r => r.json()),
 *   until: (data) => data.status === 'completed',
 *   intervalMs: 2000,
 *   timeoutMs: 120000,
 *   description: 'sponsorship completion',
 * })
 * ```
 */
export async function poll<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const {
    fn,
    until,
    intervalMs = 2_000,
    timeoutMs = 30_000,
    description,
  } = options

  const startTime = Date.now()
  let attempts = 0
  let lastResult: T | undefined

  while (true) {
    attempts++

    try {
      lastResult = await fn()
      if (until(lastResult)) {
        return {
          success: true,
          result: lastResult,
          attempts,
          elapsedMs: Date.now() - startTime,
        }
      }
    } catch {
      // Swallow errors during polling; let timeout handle failure
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= timeoutMs) {
      return {
        success: false,
        result: lastResult,
        attempts,
        elapsedMs: elapsed,
      }
    }

    // Wait for the next interval
    await sleep(intervalMs)
  }
}

// ─── Environment Variable Helpers ────────────────────────────────────────────

/**
 * Check that a set of environment variables are present (non-empty).
 * Returns an object with the variable names as keys and their presence as values.
 */
export function checkEnvVars(
  varNames: string[]
): Record<string, { present: boolean; value: string }> {
  const result: Record<string, { present: boolean; value: string }> = {}

  for (const name of varNames) {
    const value = process.env[name] ?? ''
    result[name] = {
      present: value.length > 0,
      value,
    }
  }

  return result
}

/**
 * Assert that all specified environment variables are present.
 * Returns the list of missing variable names (empty array if all present).
 */
export function getMissingEnvVars(varNames: string[]): string[] {
  return varNames.filter((name) => !process.env[name])
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Make a JSON-RPC call to the configured RPC endpoint.
 */
export async function jsonRpcCall(
  method: string,
  params: unknown[] = [],
  timeoutMs: number = CHAIN_ID_VERIFY_TIMEOUT_MS
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(CHAIN_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: 1,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as { result?: unknown; error?: { message: string } }

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`)
    }

    return data.result
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Check if the full stack is available (API + database + RPC).
 * Useful for gating lifecycle and E2E tests.
 */
export async function isFullStackReachable(): Promise<boolean> {
  const [api, db, rpc] = await Promise.all([
    isApiReachable(),
    isDatabaseReachable(),
    isRpcReachable(),
  ])
  return api && db && rpc
}
