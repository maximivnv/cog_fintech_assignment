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
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                scope="col"
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                  c.align === "right" ? "text-right" : "text-left"
                } ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-slate-50">
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`px-3 py-2 align-top text-slate-800 ${
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
