import type { Metadata } from 'next'
import { InfraRefresh } from '@/components/features/infra-refresh'

export const metadata: Metadata = {
  title: 'Infrastructure | ArcPass',
  description:
    'Real-time health status of all ArcPass infrastructure components.',
  openGraph: {
    title: 'Infrastructure | ArcPass',
    description:
      'Real-time health status of all ArcPass infrastructure components.',
    type: 'website',
  },
}

export default function InfrastructurePage() {
  return (
    <main className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Infrastructure Status
        </h1>
        <p className="mt-2 text-foreground-muted">
          Real-time health status of all ArcPass infrastructure components.
          Use the refresh button to re-check connectivity.
        </p>
      </div>

      <InfraRefresh />
    </main>
  )
}
