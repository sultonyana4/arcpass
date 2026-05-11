import type { BadgeProps } from '@/types/components'

const statusConfig: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  pending: {
    dot: 'bg-amber-400',
    bg: 'bg-amber-400/10',
    text: 'text-amber-400',
    label: 'Status: pending',
  },
  approved: {
    dot: 'bg-blue-400',
    bg: 'bg-blue-400/10',
    text: 'text-blue-400',
    label: 'Status: approved',
  },
  rejected: {
    dot: 'bg-red-400',
    bg: 'bg-red-400/10',
    text: 'text-red-400',
    label: 'Status: rejected',
  },
  relayed: {
    dot: 'bg-purple-400',
    bg: 'bg-purple-400/10',
    text: 'text-purple-400',
    label: 'Status: relayed',
  },
  completed: {
    dot: 'bg-green-400',
    bg: 'bg-green-400/10',
    text: 'text-green-400',
    label: 'Status: completed',
  },
  failed: {
    dot: 'bg-red-600',
    bg: 'bg-red-600/10',
    text: 'text-red-500',
    label: 'Status: failed',
  },
  queued: {
    dot: 'bg-gray-400',
    bg: 'bg-gray-400/10',
    text: 'text-gray-400',
    label: 'Status: queued',
  },
  submitted: {
    dot: 'bg-cyan-400',
    bg: 'bg-cyan-400/10',
    text: 'text-cyan-400',
    label: 'Status: submitted',
  },
  confirmed: {
    dot: 'bg-green-400',
    bg: 'bg-green-400/10',
    text: 'text-green-400',
    label: 'Status: confirmed',
  },
}

export function Badge({ status }: BadgeProps) {
  const config = statusConfig[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}
      aria-label={config.label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {status}
    </span>
  )
}
