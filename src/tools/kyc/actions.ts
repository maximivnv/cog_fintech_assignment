import { z } from "zod";
import {
  InvalidStateError,
  NotFoundError,
  PermissionDeniedError,
  defineAction,
  now,
  type ActionContext,
  type ApprovalContext,
  type ApprovalKind,
  type Db,
} from "@/platform";
import { TOOL } from "./manifest";
import { getCaseRow, isHighRisk, type KycCaseRow } from "./queries";

const caseId = z.string().min(1);
const reason = z.string().trim().min(1, "A reason is required").max(1000);

function loadCase(db: Db, id: string): KycCaseRow {
  const c = getCaseRow(id, db);
  if (!c) throw new NotFoundError(`KYC case ${id} not found`);
  return c;
}

/** Load the case and tag the audit row with it up front, so failed calls are traceable too. */
function loadCaseFor(ctx: ActionContext, id: string): KycCaseRow {
  const c = loadCase(ctx.db, id);
  ctx.audit({ entityId: c.id });
  return c;
}

/** Take an open case. From then on only the assignee can decide it. */
export const claimCase = defineAction({
  tool: TOOL,
  name: "claim",
  permission: "kyc:decide",
  input: z.object({ caseId }),
  handler(ctx, input) {
    const c = loadCaseFor(ctx, input.caseId);
    if (c.status !== "open") {
      throw new InvalidStateError(`Case ${c.id} is ${c.status}${c.assignee_id ? ` (assigned to ${c.assignee_id})` : ""}, not open`);
    }
    const claimedAt = now();
    ctx.db.prepare("UPDATE kyc_cases SET status = 'claimed', assignee_id = ?, claimed_at = ? WHERE id = ?").run(ctx.user.id, claimedAt, c.id);
    ctx.audit({ before: { status: c.status, assigneeId: c.assignee_id }, after: { status: "claimed", assigneeId: ctx.user.id } });
    return { id: c.id, status: "claimed" as const };
  },
});

/**
 * The assignee approves or rejects a claimed case with a reason. Rejections are final.
 * Approving a high-risk case (score at or above the threshold, or a watchlist hit) only
 * records a recommendation and asks a KYC lead to sign off.
 */
export const decideCase = defineAction({
  tool: TOOL,
  name: "decide",
  permission: "kyc:decide",
  input: z.object({ caseId, decision: z.enum(["approve", "reject"]), reason }),
  handler(ctx, input) {
    const c = loadCaseFor(ctx, input.caseId);
    if (c.status !== "claimed") throw new InvalidStateError(`Case ${c.id} is ${c.status}; only a claimed case can be decided`);
    if (c.assignee_id !== ctx.user.id) {
      throw new PermissionDeniedError(`Case ${c.id} is assigned to ${c.assignee_id}; only the assignee can decide it`);
    }
    const ts = now();

    if (input.decision === "reject") {
      ctx.db
        .prepare("UPDATE kyc_cases SET status = 'rejected', decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?")
        .run(ctx.user.id, input.reason, ts, c.id);
      ctx.audit({ before: { status: c.status }, after: { status: "rejected" } });
      return { id: c.id, status: "rejected" as const };
    }

    if (isHighRisk(c)) {
      const approvalId = ctx.requestApproval({
        kind: "high_risk_approval",
        entityId: c.id,
        summary: `Approve high-risk KYC case ${c.id} (${c.applicant_name}, score ${c.risk_score}${c.watchlist_hit ? ", watchlist hit" : ""}): ${input.reason}`,
      });
      ctx.db
        .prepare("UPDATE kyc_cases SET status = 'pending_lead_review', recommendation_reason = ?, approval_id = ? WHERE id = ?")
        .run(input.reason, approvalId, c.id);
      ctx.audit({ before: { status: c.status }, after: { status: "pending_lead_review", approvalId } });
      return { id: c.id, status: "pending_lead_review" as const };
    }

    ctx.db
      .prepare("UPDATE kyc_cases SET status = 'approved', decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?")
      .run(ctx.user.id, input.reason, ts, c.id);
    ctx.audit({ before: { status: c.status }, after: { status: "approved" } });
    return { id: c.id, status: "approved" as const };
  },
});

/** Return the applicant's date of birth and document number in the clear. Audited with the reason. */
export const revealPii = defineAction({
  tool: TOOL,
  name: "reveal_pii",
  permission: "kyc:reveal_pii",
  input: z.object({ caseId, reason }),
  handler(ctx, input) {
    const c = loadCaseFor(ctx, input.caseId);
    ctx.audit({ fields: ["date_of_birth", "document_number"] });
    return { id: c.id, date_of_birth: c.date_of_birth, document_number: c.document_number };
  },
});

function settle(ctx: ApprovalContext, status: "approved" | "rejected"): void {
  const c = loadCase(ctx.db, ctx.approval.entity_id);
  if (c.status !== "pending_lead_review") throw new InvalidStateError(`Case ${c.id} is ${c.status}, not waiting on a lead`);
  ctx.db
    .prepare("UPDATE kyc_cases SET status = ?, decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?")
    .run(status, ctx.user.id, ctx.reason, now(), c.id);
  ctx.audit({ before: { status: c.status }, after: { status } });
}

/** A KYC lead signs off (or refuses) the assignee's recommendation to approve a high-risk case. */
const highRiskApproval: ApprovalKind = {
  permission: "kyc:approve_high_risk",
  onApprove: (ctx) => settle(ctx, "approved"),
  onReject: (ctx) => settle(ctx, "rejected"),
};

export const approvals = { high_risk_approval: highRiskApproval } satisfies Record<string, ApprovalKind>;
