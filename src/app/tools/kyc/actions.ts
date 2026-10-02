"use server";

import { redirect } from "next/navigation";
import { decideApproval, errorMessage, requireUser } from "@/platform";
import { claimCase, decideCase, revealPii } from "@/tools/kyc/actions";

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
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
  const decision = text(formData, "decision") === "approve" ? "approve" : "reject";
  let error: string | null = null;
  try {
    await decideCase(user, { caseId, decision, reason: text(formData, "reason") });
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
  const decision = text(formData, "decision") === "approve" ? "approve" : "reject";
  let error: string | null = null;
  try {
    await decideApproval(user, approvalId, decision, text(formData, "reason"));
  } catch (err) {
    error = errorMessage(err);
  }
  backToCase(caseId, error);
}
