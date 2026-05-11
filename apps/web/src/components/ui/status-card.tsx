import type { StatusCardProps } from '@/types/components'

const statusConfig = {
  healthy: {
    colorClass: 'bg-status-healthy',
    label: 'Healthy',
  },
  degraded: {
    colorClass: 'bg-status-degraded',
    label: 'Degraded',
  },
  offline: {
    colorClass: 'bg-status-offline',
    label: 'Offline',
  },
} as const

export function StatusCard({ label, value, status }: StatusCardProps) {
  return (
    <article
      className="rounded-lg border border-background-border bg-background-card p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground-muted">{label}</h3>
        {status && (
          <span
            role="status"
            aria-label={`Status: ${statusConfig[status].label}`}
            className={`inline-block h-2.5 w-2.5 rounded-full ${statusConfig[status].colorClass}`}
          />
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </article>
  )
}
