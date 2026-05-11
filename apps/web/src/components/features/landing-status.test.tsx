import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  checkHealth: vi.fn(),
}))

import { checkHealth } from '@/lib/api-client'
import { LandingStatus } from './landing-status'

const mockCheckHealth = vi.mocked(checkHealth)

describe('LandingStatus', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockCheckHealth.mockReset()
  })

  it('renders loading state initially', () => {
    mockCheckHealth.mockReturnValue(new Promise(() => {}))
    render(<LandingStatus />)

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Infrastructure status: checking',
    )
    expect(screen.getByText('Checking status…')).toBeInTheDocument()
  })

  it('renders healthy state when API responds with ok', async () => {
    mockCheckHealth.mockResolvedValue({ status: 'ok', uptime: 12345 })
    render(<LandingStatus />)

    await waitFor(() => {
      expect(screen.getByText('All systems operational')).toBeInTheDocument()
    })

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Infrastructure status: healthy',
    )
  })

  it('renders degraded state when API call fails', async () => {
    mockCheckHealth.mockRejectedValue(new Error('Network error'))
    render(<LandingStatus />)

    await waitFor(() => {
      expect(screen.getByText('Degraded')).toBeInTheDocument()
    })

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Infrastructure status: degraded',
    )
  })

  it('renders degraded state when 5-second timeout is exceeded', async () => {
    vi.useFakeTimers()
    mockCheckHealth.mockReturnValue(new Promise(() => {})) // never resolves

    render(<LandingStatus />)

    // Advance past the 5-second timeout
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByText('Degraded')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('does not block page render while loading', () => {
    mockCheckHealth.mockReturnValue(new Promise(() => {}))
    const { container } = render(<LandingStatus />)

    // Component renders immediately in loading state without waiting for fetch
    expect(container.firstChild).toBeInTheDocument()
    expect(screen.getByText('Checking status…')).toBeInTheDocument()
  })
})
