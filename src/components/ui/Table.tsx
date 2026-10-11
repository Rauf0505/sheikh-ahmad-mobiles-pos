import { cn } from '../../lib/utils';

interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No data available',
}: TableProps<T>) {
  const alignmentClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <div className="w-full rounded-xl overflow-hidden bg-surface-container-lowest border border-outline-variant">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface-container">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'py-4 px-6 text-[13px] font-semibold text-on-surface-variant uppercase tracking-wider',
                  alignmentClasses[col.align || 'left'],
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="py-12 px-6 text-center text-[14px] text-outline"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'border-t border-outline-variant',
                  onRowClick &&
                    'cursor-pointer hover:bg-surface-container-low transition-colors'
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'py-4 px-6 text-[14px] text-on-surface',
                      alignmentClasses[col.align || 'left'],
                      col.className
                    )}
                  >
                    {col.render
                      ? col.render(row)
                      : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
