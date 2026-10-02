"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideApproval, errorMessage, requireUser, type Decision } from "@/platform";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Approve or reject a pending approval. All checks live in `decideApproval`. */
export async function decide(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = field(formData, "id");
  const decision = field(formData, "decision");
  const reason = field(formData, "reason");

  if (decision !== "approve" && decision !== "reject") {
    redirect(`/approvals?error=${encodeURIComponent("Pick approve or reject.")}`);
  }

  try {
    await decideApproval(user, id, decision as Decision, reason);
  } catch (err) {
    redirect(`/approvals?error=${encodeURIComponent(errorMessage(err))}`);
  }
  revalidatePath("/approvals");
  redirect(`/approvals?ok=${encodeURIComponent(`${decision === "approve" ? "Approved" : "Rejected"} ${id}.`)}`);
}
