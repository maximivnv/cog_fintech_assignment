import { daysLeft, type Dispute } from "@/tools/disputes/queries";

/** Days until the response deadline; only meaningful while a response is still owed. */
export function DaysLeft({ dispute }: { dispute: Dispute }) {
  if (dispute.status !== "needs_response") return <span className="text-zinc-400">—</span>;
  const n = daysLeft(dispute.response_deadline);
  if (n < 0) return <span className="font-medium text-red-700">{-n === 1 ? "1 day overdue" : `${-n} days overdue`}</span>;
  if (n === 0) return <span className="font-medium text-red-700">due today</span>;
  if (n <= 3) return <span className="font-medium text-amber-700">{n === 1 ? "1 day" : `${n} days`}</span>;
  return <span>{`${n} days`}</span>;
}
