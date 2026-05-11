/**
 * Typed API client for communicating with the ArcPass Fastify API.
 * All API calls are centralized here — no direct fetch calls in components.
 */

import { config } from '@/config/env'
import type {
  HealthResponse,
  WalletResponse,
  WalletHistoryResponse,
  SponsorshipResponse,
  SponsorshipDetailResponse,
  RelayResponse,
} from '@/types/api'

// --- Error Types ---

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public override message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class NetworkError extends Error {
  constructor(message: string = 'Network request failed') {
    super(message)
    this.name = 'NetworkError'
  }
}

export class TimeoutError extends Error {
  constructor(message: string = 'Request timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

// --- Wallet Address Validation ---

const WALLET_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/

/**
 * Validates that a string is a valid Ethereum-style wallet address.
 * Must match the pattern: 0x followed by exactly 40 hex characters.
 */
export function validateWalletAddress(address: string): boolean {
  return WALLET_ADDRESS_REGEX.test(address)
}

// --- Internal Helpers ---

const DEFAULT_TIMEOUT_MS = 10_000

interface FetchOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeoutMs?: number
}

/**
 * Wraps native fetch with a timeout via AbortController and typed error handling.
 * - Throws TimeoutError if the request exceeds the deadline
 * - Throws ApiError for non-2xx responses
 * - Throws NetworkError for network-level failures
 */
async function fetchWithTimeout<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const url = `${config.apiUrl}${path}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = {}
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorBody = await response.json()
        if (errorBody && typeof errorBody.error === 'string') {
          errorMessage = errorBody.error
        }
      } catch {
        // If we can't parse the error body, use the default message
      }
      throw new ApiError(response.status, errorMessage)
    }

    const data: T = await response.json()
    return data
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError()
    }
    throw new NetworkError(
      error instanceof Error ? error.message : 'Network request failed',
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

// --- API Client Functions ---

/** GET /health — Check API service health */
export async function checkHealth(): Promise<HealthResponse> {
  return fetchWithTimeout<HealthResponse>('/health')
}

/** POST /wallets/register — Register a new wallet */
export async function registerWallet(
  walletAddress: string,
): Promise<WalletResponse> {
  return fetchWithTimeout<WalletResponse>('/wallets/register', {
    method: 'POST',
    body: { walletAddress },
  })
}

/** GET /wallets/:address — Look up a wallet by address */
export async function lookupWallet(address: string): Promise<WalletResponse> {
  return fetchWithTimeout<WalletResponse>(`/wallets/${address}`)
}

/** GET /wallets/:address/history — Get wallet sponsorship history */
export async function getWalletHistory(
  address: string,
  cursor?: string,
  limit?: number,
): Promise<WalletHistoryResponse> {
  const params = new URLSearchParams()
  if (cursor) params.set('cursor', cursor)
  if (limit !== undefined) params.set('limit', String(limit))

  const query = params.toString()
  const path = `/wallets/${address}/history${query ? `?${query}` : ''}`
  return fetchWithTimeout<WalletHistoryResponse>(path)
}

/** POST /sponsorship/request — Create a new sponsorship request */
export async function createSponsorshipRequest(
  walletAddress: string,
): Promise<SponsorshipResponse> {
  return fetchWithTimeout<SponsorshipResponse>('/sponsorship/request', {
    method: 'POST',
    body: { walletAddress },
  })
}

/** GET /sponsorship/:id — Get sponsorship request status */
export async function getSponsorshipStatus(
  id: string,
): Promise<SponsorshipDetailResponse> {
  return fetchWithTimeout<SponsorshipDetailResponse>(`/sponsorship/${id}`)
}

/** GET /sponsorship/tx/:hash — Look up relay transaction by hash */
export async function getRelayByHash(hash: string): Promise<RelayResponse> {
  return fetchWithTimeout<RelayResponse>(`/sponsorship/tx/${hash}`)
}

/** GET /relay/:id — Look up relay transaction by ID */
export async function getRelayById(id: string): Promise<RelayResponse> {
  return fetchWithTimeout<RelayResponse>(`/relay/${id}`)
}
