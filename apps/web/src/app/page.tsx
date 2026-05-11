import type { Metadata } from 'next'
import Link from 'next/link'
import { config } from '@/config/env'
import { LandingStatus } from '@/components/features/landing-status'

export const metadata: Metadata = {
  title: 'ArcPass | Onboarding Infrastructure',
  description:
    'Gas sponsorship infrastructure for Arc Network. Solve the cold-start problem by sponsoring first transactions for new wallets.',
  openGraph: {
    title: 'ArcPass | Onboarding Infrastructure',
    description:
      'Gas sponsorship infrastructure for Arc Network. Solve the cold-start problem by sponsoring first transactions for new wallets.',
    type: 'website',
  },
}

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero Section */}
      <section className="py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          ArcPass
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-foreground-muted">
          Gas sponsorship infrastructure for Arc Network. Onboard new wallets
          with zero friction by sponsoring their first transaction.
        </p>
        <Link
          href="/request"
          className="mt-8 inline-flex h-12 items-center justify-center rounded-lg bg-accent px-6 text-base font-medium text-foreground transition-colors hover:bg-accent-hover"
        >
          Request Sponsorship
        </Link>
      </section>

      {/* Problem Section */}
      <section className="py-12">
        <h2 className="text-2xl font-semibold text-foreground">The Problem</h2>
        <div className="mt-4 rounded-lg border border-background-border bg-background-card p-6">
          <p className="text-foreground-secondary">
            New wallets on Arc face a cold-start gas barrier. Without native
            tokens to pay for gas, users cannot execute their first transaction
            — creating friction that blocks onboarding and adoption. Every new
            user needs gas before they can interact with the network, but
            acquiring gas requires an existing funded wallet or centralized
            exchange access.
          </p>
        </div>
      </section>

      {/* Solution Section */}
      <section className="py-12">
        <h2 className="text-2xl font-semibold text-foreground">
          The Solution
        </h2>
        <div className="mt-4 rounded-lg border border-background-border bg-background-card p-6">
          <p className="text-foreground-secondary">
            ArcPass sponsors the first transaction for eligible wallets via a
            relay infrastructure. When a new wallet requests sponsorship, the
            system verifies eligibility, funds the transaction through a
            SponsorVault contract, and relays it on-chain — all without the user
            needing any initial gas balance.
          </p>
        </div>
      </section>

      {/* Infrastructure Status */}
      <section className="py-12">
        <h2 className="text-2xl font-semibold text-foreground">
          Infrastructure Status
        </h2>
        <div className="mt-4 rounded-lg border border-background-border bg-background-card p-6">
          <LandingStatus />
        </div>
      </section>

      {/* Contract Addresses */}
      <section className="py-12">
        <h2 className="text-2xl font-semibold text-foreground">
          Deployed Contracts
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-background-border bg-background-card p-4">
            <h3 className="text-sm font-medium text-foreground-muted">
              SponsorVault
            </h3>
            <p className="mt-1 break-all font-mono text-sm text-foreground-secondary">
              {config.sponsorVaultAddress ?? 'Not configured'}
            </p>
          </div>
          <div className="rounded-lg border border-background-border bg-background-card p-4">
            <h3 className="text-sm font-medium text-foreground-muted">
              SponsorshipRegistry
            </h3>
            <p className="mt-1 break-all font-mono text-sm text-foreground-secondary">
              {config.sponsorshipRegistryAddress ?? 'Not configured'}
            </p>
          </div>
        </div>
      </section>

      {/* Architecture Overview */}
      <section className="py-12">
        <h2 className="text-2xl font-semibold text-foreground">
          Architecture Overview
        </h2>
        <div className="mt-4 overflow-x-auto rounded-lg border border-background-border bg-background-card p-6">
          <div className="flex min-w-[500px] items-center justify-between gap-2">
            <ArchNode label="Frontend" sublabel="Next.js" />
            <Arrow />
            <ArchNode label="API" sublabel="Fastify" />
            <Arrow />
            <ArchNode label="Worker" sublabel="Relay" />
            <Arrow />
            <ArchNode label="Database" sublabel="PostgreSQL" />
            <Arrow />
            <ArchNode label="Contracts" sublabel="Arc Network" />
          </div>
        </div>
      </section>

      {/* GitHub Link */}
      <section className="py-12">
        <h2 className="text-2xl font-semibold text-foreground">Source Code</h2>
        <div className="mt-4 rounded-lg border border-background-border bg-background-card p-6">
          {config.githubUrl ? (
            <a
              href={config.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center text-accent hover:text-accent-hover transition-colors"
            >
              {config.githubUrl}
            </a>
          ) : (
            <span className="text-foreground-muted">Not configured</span>
          )}
        </div>
      </section>
    </div>
  )
}

function ArchNode({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-background-border bg-background-elevated px-4 py-3 text-center">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="mt-0.5 text-xs text-foreground-muted">{sublabel}</span>
    </div>
  )
}

function Arrow() {
  return (
    <span className="text-foreground-muted" aria-hidden="true">
      →
    </span>
  )
}
