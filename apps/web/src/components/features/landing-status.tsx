"use client"

import { useEffect, useState } from 'react'
import { checkHealth } from '@/lib/api-client'

type LandingHealthStatus = 'loading' | 'healthy' | 'degraded'

const HEALTH_TIMEOUT_MS = 5_000

/**
 * Landing page health status indicator.
 * Fetches the API health endpoint on mount with a 5-second timeout.
 * Displays healthy or degraded state without blocking page render.
 */
export function LandingStatus() {
  const [status, setStatus] = useState<LandingHealthStatus>('loading')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)

    async function fetchHealth() {
      try {
        // Race checkHealth against a 5-second deadline via AbortController
        await checkHealth()
        if (!cancelled && !controller.signal.aborted) {
          setStatus('healthy')
        }
      } catch {
        if (!cancelled) {
          setStatus('degraded')
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }

    // Listen for abort (timeout) to set degraded immediately
    controller.signal.addEventListener('abort', () => {
      if (!cancelled) {
        setStatus('degraded')
      }
    })

    fetchHealth()

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timeoutId)
    }
  }, [])

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-background-border bg-background-card px-3 py-1.5"
      role="status"
      aria-label={`Infrastructure status: ${status === 'loading' ? 'checking' : status}`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${getStatusColor(status)}`}
      />
      <span className="text-sm font-medium text-foreground-muted">
        {getStatusLabel(status)}
      </span>
    </div>
  )
}

function getStatusColor(status: LandingHealthStatus): string {
  switch (status) {
    case 'loading':
      return 'bg-foreground-muted animate-pulse'
    case 'healthy':
      return 'bg-status-healthy'
    case 'degraded':
      return 'bg-status-degraded'
  }
}

function getStatusLabel(status: LandingHealthStatus): string {
  switch (status) {
    case 'loading':
      return 'Checking status…'
    case 'healthy':
      return 'All systems operational'
    case 'degraded':
      return 'Degraded'
  }
}
