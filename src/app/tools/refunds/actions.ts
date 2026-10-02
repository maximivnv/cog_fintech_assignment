"use server";

import { redirect } from "next/navigation";
import { decideApproval, errorMessage, parseDollarsToCents, requireUser, type Decision } from "@/platform";
import { requestRefund } from "@/tools/refunds/actions";

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function submitRefundRequest(formData: FormData): Promise<void> {
  const user = await requireUser();
  const chargeId = text(formData, "chargeId");
  const amount = text(formData, "amount");
  const reason = text(formData, "reason");

  let id: string | null = null;
  let error: string | null = null;
  try {
    // An unparsable amount goes through as-is so the action rejects (and audits) it.
    ({ id } = await requestRefund(user, { chargeId, amountCents: parseDollarsToCents(amount) ?? amount, reason }));
  } catch (err) {
    error = errorMessage(err);
  }
  if (error !== null || id === null) {
    const q = new URLSearchParams({ error: error ?? "Request failed", chargeId, amount, reason });
    redirect(`/tools/refunds/new?${q}`);
  }
  redirect(`/tools/refunds/${id}`);
}

export async function decideRefund(formData: FormData): Promise<void> {
  const user = await requireUser();
  const refundId = text(formData, "refundId");
  const approvalId = text(formData, "approvalId");
  // The decision goes through as-is so decideApproval's schema rejects (and audits) anything but approve/reject.
  const decision = text(formData, "decision") as Decision;

  let error: string | null = null;
  try {
    await decideApproval(user, approvalId, decision, text(formData, "reason"));
  } catch (err) {
    error = errorMessage(err);
  }
  redirect(`/tools/refunds/${refundId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}
