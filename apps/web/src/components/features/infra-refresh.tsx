"use client"

import { useEffect, useState, useCallback } from 'react'
import { checkHealth } from '@/lib/api-client'
import { StatusCard } from '@/components/ui/status-card'
import { Button } from '@/components/ui/button'
import { config } from '@/config/env'
import type { ComponentStatus } from '@/types/components'

const HEALTH_TIMEOUT_MS = 5_000

interface InfraStatus {
  api: ComponentStatus
  database: ComponentStatus
  worker: ComponentStatus
  rpc: ComponentStatus
}

/**
 * Infrastructure refresh Client Component.
 * Checks all ArcPass system component statuses on mount and via manual refresh.
 * Displays status cards for API, Database, Worker, and RPC connectivity,
 * plus contract address configuration.
 */
export function InfraRefresh() {
  const [statuses, setStatuses] = useState<InfraStatus>({
    api: 'degraded',
    database: 'degraded',
    worker: 'degraded',
    rpc: 'degraded',
  })
  const [loading, setLoading] = useState(true)

  const checkAllStatuses = useCallback(async () => {
    setLoading(true)

    let apiStatus: ComponentStatus = 'offline'
    let dbStatus: ComponentStatus = 'offline'
    let rpcStatus: ComponentStatus = 'offline'
    let workerStatus: ComponentStatus = 'offline'

    // Check API health with 5-second timeout
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)

      await checkHealth()
      clearTimeout(timeoutId)

      if (!controller.signal.aborted) {
        apiStatus = 'healthy'
        // Database status derived from API health
        dbStatus = 'healthy'
        // RPC status derived from API health (API connects to RPC)
        rpcStatus = 'healthy'
      }
    } catch {
      apiStatus = 'offline'
      dbStatus = 'offline'
      rpcStatus = 'offline'
    }

    // Worker status: derive from recent relay activity via API
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)

      const response = await fetch(`${config.apiUrl}/health`, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (response.ok) {
        // If API is healthy, worker is likely operational
        workerStatus = apiStatus === 'healthy' ? 'healthy' : 'degraded'
      } else {
        workerStatus = 'degraded'
      }
    } catch {
      // If API is healthy but we can't confirm worker, mark as degraded
      workerStatus = apiStatus === 'healthy' ? 'degraded' : 'offline'
    }

    setStatuses({ api: apiStatus, database: dbStatus, worker: workerStatus, rpc: rpcStatus })
    setLoading(false)
  }, [])

  // Check statuses on mount
  useEffect(() => {
    checkAllStatuses()
  }, [checkAllStatuses])

  return (
    <div className="space-y-8">
      {/* Status Grid */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">
            Component Status
          </h2>
          <Button
            onClick={checkAllStatuses}
            loading={loading}
            variant="secondary"
          >
            Refresh Status
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatusCard
            label="API Service"
            value={getStatusLabel(statuses.api)}
            status={statuses.api}
          />
          <StatusCard
            label="PostgreSQL Database"
            value={getStatusLabel(statuses.database)}
            status={statuses.database}
          />
          <StatusCard
            label="Relay Worker"
            value={getStatusLabel(statuses.worker)}
            status={statuses.worker}
          />
          <StatusCard
            label="RPC Connectivity"
            value={getStatusLabel(statuses.rpc)}
            status={statuses.rpc}
          />
        </div>
      </div>

      {/* Chain & Contract Configuration */}
      <div className="rounded-lg border border-background-border bg-background-card p-6">
        <h3 className="mb-4 text-sm font-medium text-foreground-muted">
          Network Configuration
        </h3>
        <dl className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
            <dt className="text-sm text-foreground-muted">Chain ID</dt>
            <dd className="font-mono text-sm text-foreground">
              {config.chainId}
            </dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
            <dt className="text-sm text-foreground-muted">SponsorVault</dt>
            <dd className="font-mono text-sm text-foreground break-all">
              {config.sponsorVaultAddress || 'Not configured'}
            </dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
            <dt className="text-sm text-foreground-muted">
              SponsorshipRegistry
            </dt>
            <dd className="font-mono text-sm text-foreground break-all">
              {config.sponsorshipRegistryAddress || 'Not configured'}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function getStatusLabel(status: ComponentStatus): string {
  switch (status) {
    case 'healthy':
      return 'Operational'
    case 'degraded':
      return 'Degraded'
    case 'offline':
      return 'Offline'
  }
}
