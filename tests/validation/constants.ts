/**
 * Shared constants for the ArcPass runtime validation suite.
 *
 * All values are derived from environment variables with sensible defaults
 * for local development. These constants are imported by all validation test files.
 */

// ─── Service URLs ────────────────────────────────────────────────────────────

/** Base URL for the Fastify API server */
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000'

/** Arc testnet JSON-RPC endpoint */
export const CHAIN_RPC_URL = process.env.CHAIN_RPC_URL || ''

/** PostgreSQL connection string */
export const DATABASE_URL = process.env.DATABASE_URL || ''

// ─── Chain Configuration ─────────────────────────────────────────────────────

/** Expected chain ID for Arc testnet */
export const EXPECTED_CHAIN_ID = 1942999

/** Explorer base URL for transaction links */
export const EXPLORER_BASE_URL =
  process.env.EXPLORER_BASE_URL || 'https://testnet.arcscan.io/tx/'

// ─── Contract Addresses ──────────────────────────────────────────────────────

/** Deployed SponsorVault contract address */
export const CONTRACT_ADDRESS_SPONSOR_VAULT =
  process.env.CONTRACT_ADDRESS_SPONSOR_VAULT || ''

/** Deployed SponsorshipRegistry contract address */
export const CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY =
  process.env.CONTRACT_ADDRESS_SPONSORSHIP_REGISTRY || ''

// ─── Timeouts ────────────────────────────────────────────────────────────────

/** Timeout for database connectivity checks (ms) */
export const DB_CONNECTION_TIMEOUT_MS = 5_000

/** Timeout for API health check (ms) */
export const API_HEALTH_TIMEOUT_MS = 10_000

/** Timeout for chain ID verification (ms) */
export const CHAIN_ID_VERIFY_TIMEOUT_MS = 10_000

/** Timeout for contract bytecode verification (ms) */
export const CONTRACT_BYTECODE_TIMEOUT_MS = 10_000

/** Timeout for first poll cycle (ms) */
export const POLL_CYCLE_TIMEOUT_MS = 10_000

/** Timeout for sponsorship lifecycle completion (ms) */
export const LIFECYCLE_TIMEOUT_MS = 120_000

/** Timeout for transaction receipt retrieval (ms) */
export const RECEIPT_TIMEOUT_MS = 30_000

/** Timeout for E2E script execution (ms) */
export const E2E_SCRIPT_TIMEOUT_MS = 180_000

// ─── Polling Configuration ───────────────────────────────────────────────────

/** Default polling interval for status checks (ms) */
export const DEFAULT_POLL_INTERVAL_MS = 2_000

/** Default worker poll interval (ms) */
export const DEFAULT_WORKER_POLL_INTERVAL_MS = 5_000
