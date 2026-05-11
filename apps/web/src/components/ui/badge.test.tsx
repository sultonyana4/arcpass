import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Badge } from './badge'

describe('Badge', () => {
  it('renders the status text', () => {
    render(<Badge status="pending" />)
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('includes aria-label describing the status', () => {
    render(<Badge status="approved" />)
    const badge = screen.getByLabelText('Status: approved')
    expect(badge).toBeInTheDocument()
  })

  it('renders a colored dot indicator', () => {
    const { container } = render(<Badge status="failed" />)
    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toBeInTheDocument()
    expect(dot).toHaveClass('rounded-full')
  })

  it('applies unique color classes for each sponsorship status', () => {
    const statuses = ['pending', 'approved', 'rejected', 'relayed', 'completed', 'failed'] as const
    const classMap = new Map<string, string>()

    for (const status of statuses) {
      const { container } = render(<Badge status={status} />)
      const span = container.querySelector(`[aria-label="Status: ${status}"]`)
      classMap.set(status, span?.className ?? '')
    }

    // Each status except confirmed/completed (which share green) should have unique styling
    expect(classMap.get('pending')).not.toBe(classMap.get('approved'))
    expect(classMap.get('approved')).not.toBe(classMap.get('rejected'))
    expect(classMap.get('rejected')).not.toBe(classMap.get('relayed'))
    expect(classMap.get('relayed')).not.toBe(classMap.get('completed'))
    expect(classMap.get('rejected')).not.toBe(classMap.get('failed'))
  })

  it('applies unique color classes for each relay status', () => {
    const statuses = ['queued', 'submitted', 'confirmed', 'failed'] as const
    const classMap = new Map<string, string>()

    for (const status of statuses) {
      const { container } = render(<Badge status={status} />)
      const span = container.querySelector(`[aria-label="Status: ${status}"]`)
      classMap.set(status, span?.className ?? '')
    }

    expect(classMap.get('queued')).not.toBe(classMap.get('submitted'))
    expect(classMap.get('submitted')).not.toBe(classMap.get('confirmed'))
    expect(classMap.get('queued')).not.toBe(classMap.get('failed'))
  })

  it('renders as a semantic span element', () => {
    const { container } = render(<Badge status="completed" />)
    const badge = container.querySelector('span[aria-label]')
    expect(badge).toBeInTheDocument()
    expect(badge?.tagName).toBe('SPAN')
  })

  it('renders with pill shape classes', () => {
    render(<Badge status="queued" />)
    const badge = screen.getByLabelText('Status: queued')
    expect(badge).toHaveClass('rounded-full')
    expect(badge).toHaveClass('inline-flex')
  })
})
