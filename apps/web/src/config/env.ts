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
 * Server-side (SSR) uses API_URL_INTERNAL if available (for Docker networking).
 * Client-side (browser) always uses NEXT_PUBLIC_API_URL.
 */
function resolveApiUrl(): string {
  // In the browser, only NEXT_PUBLIC_* vars are available
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
  }
  // Server-side: prefer internal URL for Docker service-to-service communication
  return process.env.API_URL_INTERNAL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
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
