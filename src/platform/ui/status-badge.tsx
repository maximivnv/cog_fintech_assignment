type Tone = "neutral" | "pending" | "success" | "danger";

const toneClass: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-600",
  pending: "bg-amber-50 text-amber-700",
  success: "bg-green-50 text-green-700",
  danger: "bg-red-50 text-red-700",
};

function toneFor(status: string): Tone {
  const s = status.toLowerCase();
  if (s.startsWith("pending")) return "pending";
  if (s === "executed" || s === "approved") return "success";
  if (s === "rejected" || s === "failed") return "danger";
  return "neutral";
}

export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  const t = tone ?? toneFor(status);
  return (
    <span
      className={`inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-xs font-medium leading-none ${toneClass[t]}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
