import { NextResponse } from 'next/server'

/**
 * GET /api/config — Exposes runtime environment configuration to the client.
 *
 * NEXT_PUBLIC_* vars are inlined at build time by Next.js. When using standalone
 * Docker builds, contract addresses may not be known at build time. This endpoint
 * reads them from the runtime environment and serves them to the client.
 */
export function GET() {
  return NextResponse.json({
    sponsorVaultAddress: process.env.NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS || null,
    sponsorshipRegistryAddress:
      process.env.NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS || null,
    explorerUrl:
      process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://testnet.arcscan.app/tx/',
    chainId: 5042002,
    githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL || null,
  })
}
