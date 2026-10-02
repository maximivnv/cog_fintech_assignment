import { formatCents } from "../money";

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`whitespace-nowrap tabular-nums ${className}`}>{formatCents(cents)}</span>;
}
