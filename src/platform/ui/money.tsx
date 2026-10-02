import { formatCents } from "../money";

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatCents(cents)}</span>;
}
