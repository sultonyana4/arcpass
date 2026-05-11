'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Client Component island for manual dashboard refresh.
 * Re-fetches metrics and recent requests by triggering a router refresh.
 */
export function DashboardRefresh() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleRefresh() {
    setLoading(true)
    router.refresh()
    // Allow a brief delay for the refresh to propagate
    setTimeout(() => setLoading(false), 1000)
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={loading}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-background-border bg-background-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background-elevated disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Refresh dashboard data"
      aria-busy={loading || undefined}
    >
      {loading ? (
        <>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-foreground-muted border-t-transparent" aria-hidden="true" />
          Refreshing...
        </>
      ) : (
        <>
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </>
      )}
    </button>
  )
}
