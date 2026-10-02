"use server";

import { redirect } from "next/navigation";
import { decideApproval, errorMessage, requireUser, type Decision } from "@/platform";
import { acceptLoss, addNote, recordOutcome, submitResponse } from "@/tools/disputes/actions";

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function back(disputeId: string, error: string | null): never {
  redirect(`/tools/disputes/${disputeId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

async function run(disputeId: string, fn: () => Promise<unknown>): Promise<void> {
  let error: string | null = null;
  try {
    await fn();
  } catch (err) {
    error = errorMessage(err);
  }
  back(disputeId, error);
}

export async function addDisputeNote(formData: FormData): Promise<void> {
  const user = await requireUser();
  const disputeId = text(formData, "disputeId");
  await run(disputeId, () => addNote(user, { disputeId, body: text(formData, "reason") }));
}

export async function submitDisputeResponse(formData: FormData): Promise<void> {
  const user = await requireUser();
  const disputeId = text(formData, "disputeId");
  await run(disputeId, () => submitResponse(user, { disputeId }));
}

export async function acceptDisputeLoss(formData: FormData): Promise<void> {
  const user = await requireUser();
  const disputeId = text(formData, "disputeId");
  await run(disputeId, () => acceptLoss(user, { disputeId, reason: text(formData, "reason") }));
}

export async function recordDisputeOutcome(formData: FormData): Promise<void> {
  const user = await requireUser();
  const disputeId = text(formData, "disputeId");
  // An unexpected outcome goes through as-is so the action rejects (and audits) it.
  await run(disputeId, () => recordOutcome(user, { disputeId, outcome: text(formData, "outcome"), reason: text(formData, "reason") }));
}

export async function decideDisputeLoss(formData: FormData): Promise<void> {
  const user = await requireUser();
  const disputeId = text(formData, "disputeId");
  // The decision goes through as-is so decideApproval's schema rejects (and audits) anything but approve/reject.
  const decision = text(formData, "decision") as Decision;
  await run(disputeId, () => decideApproval(user, text(formData, "approvalId"), decision, text(formData, "reason")));
}
