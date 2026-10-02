import Link from "next/link";
import { Alert, Card, PageHeader, buttonClass, can, formatCents, requireUser } from "@/platform";
import { listChargesWithRemaining } from "@/tools/refunds/queries";
import { submitRefundRequest } from "../actions";

const inputClass =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

export default async function NewRefundPage({ searchParams }: PageProps<"/tools/refunds/new">) {
  const user = await requireUser();
  if (!can(user, "refunds:request")) {
    return <Alert tone="error">Only support agents can request refunds.</Alert>;
  }
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const error = str(sp.error);
  const charges = listChargesWithRemaining();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="New refund request"
        description="Pick a charge, enter an amount and a reason."
        actions={
          <Link href="/tools/refunds" className={buttonClass.secondary}>
            Back
          </Link>
        }
      />
      {error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <Card>
        <form action={submitRefundRequest} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Charge</span>
            <select name="chargeId" required defaultValue={str(sp.chargeId)} className={inputClass}>
              <option value="" disabled>
                Choose a charge
              </option>
              {charges.map((c) => (
                <option key={c.id} value={c.id} disabled={c.remaining_cents <= 0}>
                  {c.id} · {c.customer} · {c.description} · {formatCents(c.amount_cents)} ({formatCents(c.remaining_cents)} left)
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Amount (USD)</span>
            <input name="amount" type="text" inputMode="decimal" required placeholder="0.00" defaultValue={str(sp.amount)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Reason</span>
            <textarea name="reason" required rows={3} maxLength={1000} defaultValue={str(sp.reason)} className={inputClass} />
          </label>
          <div>
            <button type="submit" className={buttonClass.primary}>
              Request refund
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
