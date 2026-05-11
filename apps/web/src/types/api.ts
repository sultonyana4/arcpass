import type { SponsorshipStatusValue, RelayStatusValue } from '@arcpass/shared'

export interface HealthResponse {
  status: 'ok'
  uptime: number
}

export interface WalletResponse {
  id: string
  walletAddress: string
  firstSeenAt: string
  lastSeenAt: string
  sponsorshipCount: number
  isBlocked: boolean
}

export interface WalletHistoryResponse {
  requests: SponsorshipSummary[]
  nextCursor: string | null
  total: number
}

export interface SponsorshipSummary {
  id: string
  status: SponsorshipStatusValue
  requestedAt: string
  walletAddress: string
}

export interface SponsorshipResponse {
  id: string
  walletId: string
  status: SponsorshipStatusValue
  requestedAt: string
}

export interface SponsorshipDetailResponse {
  id: string
  walletId: string
  status: SponsorshipStatusValue
  eligibilityReason: string | null
  requestedAt: string
  approvedAt: string | null
  rejectedAt: string | null
  completedAt: string | null
  failedAt: string | null
  relayTransactions: RelayResponse[]
}

export interface RelayResponse {
  id: string
  sponsorshipRequestId: string
  status: RelayStatusValue
  relayAttempt: number
  transactionHash: string | null
  submittedAt: string | null
  confirmedAt: string | null
  failedAt: string | null
  failureReason: string | null
}

export interface DashboardMetrics {
  totalRequests: number
  approvedCount: number
  rejectedCount: number
  pendingCount: number
}

export interface ApiErrorResponse {
  error: string
  statusCode: number
  retryAfter?: number
}
