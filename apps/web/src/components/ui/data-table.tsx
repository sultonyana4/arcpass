import type { DataTableProps } from '@/types/components'

export function DataTable<T>({ data, columns, emptyMessage = 'No data available' }: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-background-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-background-tertiary text-foreground-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                scope="col"
                className="px-4 py-3 font-medium whitespace-nowrap"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-background-border">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-foreground-muted"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="bg-background-card hover:bg-background-elevated transition-colors"
              >
                {columns.map((column) => (
                  <td
                    key={String(column.key)}
                    className="px-4 py-3 whitespace-nowrap"
                  >
                    {column.render
                      ? column.render(row)
                      : String((row as Record<string, unknown>)[column.key as string] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
