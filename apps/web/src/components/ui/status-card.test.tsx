import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatusCard } from './status-card'

describe('StatusCard', () => {
  it('renders label and value', () => {
    render(<StatusCard label="Total Requests" value={42} />)

    expect(screen.getByText('Total Requests')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders string value', () => {
    render(<StatusCard label="API" value="Running" />)

    expect(screen.getByText('API')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders healthy status indicator with correct aria-label', () => {
    render(<StatusCard label="API" value="OK" status="healthy" />)

    const indicator = screen.getByRole('status')
    expect(indicator).toHaveAttribute('aria-label', 'Status: Healthy')
    expect(indicator).toHaveClass('bg-status-healthy')
  })

  it('renders degraded status indicator with correct aria-label', () => {
    render(<StatusCard label="DB" value="Slow" status="degraded" />)

    const indicator = screen.getByRole('status')
    expect(indicator).toHaveAttribute('aria-label', 'Status: Degraded')
    expect(indicator).toHaveClass('bg-status-degraded')
  })

  it('renders offline status indicator with correct aria-label', () => {
    render(<StatusCard label="Worker" value="Down" status="offline" />)

    const indicator = screen.getByRole('status')
    expect(indicator).toHaveAttribute('aria-label', 'Status: Offline')
    expect(indicator).toHaveClass('bg-status-offline')
  })

  it('does not render status indicator when status is not provided', () => {
    render(<StatusCard label="Metric" value={100} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('uses semantic article element', () => {
    const { container } = render(<StatusCard label="Test" value="val" />)

    expect(container.querySelector('article')).toBeInTheDocument()
  })
})
