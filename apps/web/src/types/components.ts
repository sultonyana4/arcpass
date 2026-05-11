import type { ReactNode } from 'react'
import type { SponsorshipStatusValue, RelayStatusValue } from '@arcpass/shared'

// --- UI State Types ---

export type ComponentStatus = 'healthy' | 'degraded' | 'offline'
export type ValidationState = 'idle' | 'valid' | 'invalid'

export interface PollingState {
  isPolling: boolean
  attempts: number
  maxAttempts: number
  intervalMs: number
  error: string | null
}

export interface InfraComponentStatus {
  name: string
  status: ComponentStatus
  lastChecked: string | null
}

// --- Component Prop Interfaces ---

export interface StatusCardProps {
  label: string
  value: string | number
  status?: ComponentStatus
}

export interface ColumnDef<T> {
  key: keyof T | string
  header: string
  render?: (row: T) => ReactNode
}

export interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  emptyMessage?: string
}

export interface FormInputProps {
  label: string
  name: string
  type?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  validationState: ValidationState
  errorMessage?: string
}

export interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary'
  loading?: boolean
  disabled?: boolean
  'aria-label'?: string
}

export interface BadgeProps {
  status: SponsorshipStatusValue | RelayStatusValue
}
