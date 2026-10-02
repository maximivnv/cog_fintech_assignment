import type { ReactNode } from "react";
import { mask } from "../money";

/**
 * PII is masked unless `revealed`. Pass a reveal form (an audited action) as `children`;
 * it is only rendered while masked.
 */
export function MaskedValue({
  value,
  revealed = false,
  visible = 4,
  children,
}: {
  value: string;
  revealed?: boolean;
  visible?: number;
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`tabular-nums ${revealed ? "text-zinc-900" : "text-zinc-500"}`} title={revealed ? undefined : "Masked"}>
        {revealed ? value : mask(value, visible)}
      </span>
      {revealed ? null : children}
    </span>
  );
}
