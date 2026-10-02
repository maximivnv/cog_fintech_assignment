type Tone = "neutral" | "pending" | "success" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
};

function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  if (s.startsWith("pending") || s === "needs_response" || s === "open" || s === "claimed") return "pending";
  if (["executed", "approved", "ok", "won", "accepted", "submitted", "revealed"].includes(s)) return "success";
  if (["rejected", "denied", "failed", "lost", "refused"].includes(s)) return "danger";
  if (["in_review", "submitted"].includes(s)) return "info";
  return "neutral";
}

export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  const t = tone ?? toneFor(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClass[t]}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
