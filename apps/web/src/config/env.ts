/**
 * Centralized environment configuration module.
 * All components read config from here — no direct process.env access elsewhere.
 */

export interface AppConfig {
  apiUrl: string
  sponsorVaultAddress: string | null
  sponsorshipRegistryAddress: string | null
  explorerUrl: string
  githubUrl: string | null
  chainId: number
}

/**
 * Resolve the API URL based on execution context.
 *
 * Client-side (browser): uses relative path "/api/backend" so requests go through
 * Next.js rewrites on the same origin. No CORS, no exposed backend port.
 *
 * Server-side (SSR): uses API_URL_INTERNAL for Docker service-to-service
 * communication, falling back to localhost for local dev.
 */
function resolveApiUrl(): string {
  // In the browser, use relative path — Next.js rewrites proxy to backend
  if (typeof window !== 'undefined') {
    return '/api/backend'
  }
  // Server-side: direct service-to-service communication
  return process.env.API_URL_INTERNAL || 'http://localhost:4000'
}

export const config: AppConfig = {
  apiUrl: resolveApiUrl(),
  sponsorVaultAddress: process.env.NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS || null,
  sponsorshipRegistryAddress:
    process.env.NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS || null,
  explorerUrl:
    process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://testnet.arcscan.app/tx/',
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL || null,
  chainId: 5042002,
}
