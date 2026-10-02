"use server";

import { redirect } from "next/navigation";
import { InvalidInputError, decideApproval, errorMessage, requireUser, type Decision } from "@/platform";
import { claimCase, decideCase, revealPii } from "@/tools/kyc/actions";

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function decisionOf(formData: FormData): Decision {
  const v = text(formData, "decision");
  if (v !== "approve" && v !== "reject") {
    throw new InvalidInputError(["decision must be approve or reject"]);
  }
  return v;
}

function backToCase(caseId: string, error: string | null): never {
  redirect(`/tools/kyc/${caseId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function claimKycCase(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = text(formData, "caseId");
  let error: string | null = null;
  try {
    await claimCase(user, { caseId });
  } catch (err) {
    error = errorMessage(err);
  }
  backToCase(caseId, error);
}

export async function decideKycCase(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = text(formData, "caseId");
  let error: string | null = null;
  try {
    await decideCase(user, { caseId, decision: decisionOf(formData), reason: text(formData, "reason") });
  } catch (err) {
    error = errorMessage(err);
  }
  backToCase(caseId, error);
}

export async function revealKycPii(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = text(formData, "caseId");
  let error: string | null = null;
  try {
    await revealPii(user, { caseId, reason: text(formData, "reason") });
  } catch (err) {
    error = errorMessage(err);
  }
  backToCase(caseId, error);
}

export async function decideKycApproval(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = text(formData, "caseId");
  const approvalId = text(formData, "approvalId");
  let error: string | null = null;
  try {
    await decideApproval(user, approvalId, decisionOf(formData), text(formData, "reason"));
  } catch (err) {
    error = errorMessage(err);
  }
  backToCase(caseId, error);
}
