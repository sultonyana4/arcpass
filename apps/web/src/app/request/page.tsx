import type { Metadata } from 'next'
import { RequestForm } from '@/components/features/request-form'

export const metadata: Metadata = {
  title: 'Request Sponsorship | ArcPass',
  description:
    'Submit a wallet address to request gas sponsorship on Arc Network',
  openGraph: {
    title: 'Request Sponsorship | ArcPass',
    description:
      'Submit a wallet address to request gas sponsorship on Arc Network',
    type: 'website',
  },
}

export default function RequestPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <section className="py-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Request Sponsorship
        </h1>
        <p className="mt-4 max-w-2xl text-foreground-secondary">
          Submit your wallet address to request gas sponsorship on Arc Network.
          ArcPass will verify eligibility and sponsor your first transaction so
          you can start interacting with the network without needing initial gas.
        </p>
      </section>

      <section className="py-8">
        <RequestForm />
      </section>
    </div>
  )
}
