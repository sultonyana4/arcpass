import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DataTable } from './data-table'
import type { ColumnDef } from '@/types/components'

interface TestRow {
  id: string
  name: string
  status: string
}

const columns: ColumnDef<TestRow>[] = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
]

const sampleData: TestRow[] = [
  { id: '1', name: 'Alice', status: 'active' },
  { id: '2', name: 'Bob', status: 'inactive' },
]

describe('DataTable', () => {
  it('renders table headers from column definitions', () => {
    render(<DataTable data={sampleData} columns={columns} />)

    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('renders correct number of rows', () => {
    render(<DataTable data={sampleData} columns={columns} />)

    const rows = screen.getAllByRole('row')
    // 1 header row + 2 data rows
    expect(rows).toHaveLength(3)
  })

  it('renders cell content from row data', () => {
    render(<DataTable data={sampleData} columns={columns} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('displays default empty message when data is empty', () => {
    render(<DataTable data={[]} columns={columns} />)

    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('displays custom empty message when provided', () => {
    render(<DataTable data={[]} columns={columns} emptyMessage="No records found" />)

    expect(screen.getByText('No records found')).toBeInTheDocument()
  })

  it('uses custom render function when provided', () => {
    const columnsWithRender: ColumnDef<TestRow>[] = [
      { key: 'name', header: 'Name', render: (row) => <strong>{row.name.toUpperCase()}</strong> },
      { key: 'status', header: 'Status' },
    ]

    render(<DataTable data={sampleData} columns={columnsWithRender} />)

    expect(screen.getByText('ALICE')).toBeInTheDocument()
    expect(screen.getByText('BOB')).toBeInTheDocument()
  })

  it('uses semantic HTML table elements', () => {
    const { container } = render(<DataTable data={sampleData} columns={columns} />)

    expect(container.querySelector('table')).toBeInTheDocument()
    expect(container.querySelector('thead')).toBeInTheDocument()
    expect(container.querySelector('tbody')).toBeInTheDocument()
    expect(container.querySelectorAll('th')).toHaveLength(3)
    expect(container.querySelectorAll('td')).toHaveLength(6) // 2 rows × 3 columns
  })

  it('wraps table in scrollable container', () => {
    const { container } = render(<DataTable data={sampleData} columns={columns} />)

    const wrapper = container.firstElementChild
    expect(wrapper?.classList.contains('overflow-x-auto')).toBe(true)
  })

  it('sets colspan on empty state cell to span all columns', () => {
    const { container } = render(<DataTable data={[]} columns={columns} />)

    const td = container.querySelector('td')
    expect(td?.getAttribute('colspan')).toBe('3')
  })
})
