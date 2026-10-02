import type { ReactNode } from "react";

const buttonBase =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50";

export const buttonClass = {
  primary: `${buttonBase} bg-accent text-white hover:bg-accent-hover`,
  secondary: `${buttonBase} border border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50`,
  danger: `${buttonBase} border border-zinc-200 bg-white text-red-600 hover:border-red-200 hover:bg-red-50`,
} as const;

export type ButtonTone = keyof typeof buttonClass;

const fieldBase =
  "block w-full rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors hover:border-zinc-300 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";

/** Text inputs and selects. */
export const inputClass = `${fieldBase} h-8`;

/** Multi-line reason and note boxes. */
export const textareaClass = `${fieldBase} resize-y py-1.5 leading-5`;

/** Inline text links. */
export const linkClass = "font-medium text-accent transition-colors hover:text-accent-hover";

/** Quiet segmented filter links above a table. */
export function filterLinkClass(active: boolean): string {
  return `inline-flex h-7 items-center rounded-md px-2.5 text-[13px] transition-colors ${
    active ? "bg-white font-medium text-zinc-900 ring-1 ring-zinc-200" : "text-zinc-500 hover:text-zinc-900"
  }`;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description ? <div className="mt-1.5 text-sm text-zinc-500">{description}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Small muted label above a section, table or card body. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`mb-3 text-[13px] font-medium text-zinc-500 ${className}`}>{children}</h2>;
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-zinc-200 bg-white p-5 ${className}`}>
      {title ? <SectionLabel className="mb-4">{title}</SectionLabel> : null}
      {children}
    </section>
  );
}

export type AlertTone = "info" | "success" | "error" | "warning";

const alertClass: Record<AlertTone, string> = {
  info: "border-zinc-200 bg-white text-zinc-700",
  success: "border-green-200 bg-green-50 text-green-800",
  error: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
};

export function Alert({ tone = "info", children }: { tone?: AlertTone; children: ReactNode }) {
  return (
    <div role="alert" className={`rounded-md border px-3 py-2 text-sm ${alertClass[tone]}`}>
      {children}
    </div>
  );
}

export function DescriptionList({ items }: { items: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-8 gap-y-2.5 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-zinc-500">{label}</dt>
          <dd className="min-w-0 break-words text-zinc-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
