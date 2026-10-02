import { buttonClass } from "@/platform";
import { decide } from "./actions";

/** One reason, two outcomes. The server re-checks permission and separation of duties. */
export function DecisionForm({ approvalId }: { approvalId: string }) {
  return (
    <form action={decide} className="flex min-w-64 flex-col gap-2">
      <input type="hidden" name="id" value={approvalId} />
      <textarea
        name="reason"
        required
        rows={2}
        maxLength={1000}
        placeholder="Reason"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      />
      <div className="flex gap-2">
        <button type="submit" name="decision" value="approve" className={buttonClass.primary}>
          Approve
        </button>
        <button type="submit" name="decision" value="reject" className={buttonClass.danger}>
          Reject
        </button>
      </div>
    </form>
  );
}
