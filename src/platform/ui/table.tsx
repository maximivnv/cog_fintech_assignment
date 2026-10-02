import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  empty = "Nothing here.",
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string | number;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200">
            {columns.map((c) => (
              <th
                key={c.header}
                scope="col"
                className={`h-9 whitespace-nowrap px-4 text-xs font-medium text-zinc-500 ${
                  c.align === "right" ? "text-right" : "text-left"
                } ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-zinc-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="transition-colors hover:bg-zinc-50">
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`px-4 py-2.5 align-middle text-zinc-800 ${
                      c.align === "right" ? "text-right tabular-nums" : "text-left"
                    } ${c.className ?? ""}`}
                  >
                    {c.cell(row)}
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
