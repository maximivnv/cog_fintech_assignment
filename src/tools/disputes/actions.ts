import { z } from "zod";
import {
  InvalidStateError,
  NotFoundError,
  defineAction,
  formatCents,
  newId,
  now,
  type ActionContext,
  type ApprovalKind,
  type Db,
} from "@/platform";
import { ACCEPT_LOSS_APPROVAL_CENTS, TOOL } from "./manifest";
import { getDispute, isOpen, listNotes, type Dispute, type DisputeStatus } from "./queries";

function load(id: string, db: Db): Dispute {
  const d = getDispute(id, db);
  if (!d) throw new NotFoundError(`Dispute ${id} not found`);
  return d;
}

/** Load for an action and tag its audit row with the dispute, so failed calls are traceable too. */
function loadFor(ctx: ActionContext, id: string): Dispute {
  const d = load(id, ctx.db);
  ctx.audit({ entityId: d.id });
  return d;
}

function expectStatus(d: Dispute, status: DisputeStatus): void {
  if (d.status !== status) throw new InvalidStateError(`Dispute ${d.id} is ${d.status}, not ${status}`);
}

function expectNoPendingApproval(d: Dispute): void {
  if (d.approval_id) throw new InvalidStateError(`Dispute ${d.id} has a loss acceptance waiting on finance`);
}

/** Attach an evidence note. Allowed while the dispute is still open. */
export const addNote = defineAction({
  tool: TOOL,
  name: "add_note",
  permission: "disputes:work",
  input: z.object({
    disputeId: z.string().min(1),
    body: z.string().trim().min(1, "A note is required").max(1000),
  }),
  handler(ctx, input) {
    const d = loadFor(ctx, input.disputeId);
    if (!isOpen(d.status)) throw new InvalidStateError(`Dispute ${d.id} is ${d.status}; notes are closed`);
    const id = newId("dn");
    ctx.db
      .prepare("INSERT INTO dispute_notes (id, dispute_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, d.id, ctx.user.id, input.body, now());
    ctx.audit({ after: { noteId: id } });
    return { id };
  },
});

/** Send the evidence to the card network. Needs at least one note. */
export const submitResponse = defineAction({
  tool: TOOL,
  name: "submit_response",
  permission: "disputes:work",
  input: z.object({ disputeId: z.string().min(1) }),
  handler(ctx, input) {
    const d = loadFor(ctx, input.disputeId);
    expectStatus(d, "needs_response");
    expectNoPendingApproval(d);
    if (listNotes(d.id, ctx.db).length === 0) {
      throw new InvalidStateError(`Dispute ${d.id} has no evidence notes; add evidence before submitting`);
    }
    ctx.db.prepare("UPDATE disputes SET status = 'submitted', submitted_at = ? WHERE id = ?").run(now(), d.id);
    ctx.audit({ before: { status: d.status }, after: { status: "submitted" } });
    return { id: d.id, status: "submitted" as const };
  },
});

/**
 * Give up on the chargeback. Up to the threshold it is accepted right away; above it a finance
 * approver has to agree, and the dispute stays in needs_response until they decide.
 */
export const acceptLoss = defineAction({
  tool: TOOL,
  name: "accept_loss",
  permission: "disputes:work",
  input: z.object({
    disputeId: z.string().min(1),
    reason: z.string().trim().min(1, "A reason is required").max(1000),
  }),
  handler(ctx, input) {
    const d = loadFor(ctx, input.disputeId);
    expectStatus(d, "needs_response");
    expectNoPendingApproval(d);
    if (d.amount_cents <= ACCEPT_LOSS_APPROVAL_CENTS) {
      ctx.db.prepare("UPDATE disputes SET status = 'accepted', decided_at = ? WHERE id = ?").run(now(), d.id);
      ctx.audit({ before: { status: d.status }, after: { status: "accepted" } });
      return { id: d.id, status: "accepted" as const };
    }
    const approvalId = ctx.requestApproval({
      kind: "accept_loss",
      entityId: d.id,
      summary: `Accept loss of ${formatCents(d.amount_cents)} on dispute ${d.id} (${d.customer}, ${d.reason}): ${input.reason}`,
    });
    ctx.db.prepare("UPDATE disputes SET approval_id = ? WHERE id = ?").run(approvalId, d.id);
    ctx.audit({ before: { status: d.status }, after: { status: d.status, approvalId } });
    return { id: d.id, status: d.status };
  },
});

/** Record the card network's verdict on a submitted response. */
export const recordOutcome = defineAction({
  tool: TOOL,
  name: "record_outcome",
  permission: "disputes:work",
  input: z.object({
    disputeId: z.string().min(1),
    outcome: z.enum(["won", "lost"]),
    reason: z.string().trim().min(1, "A reason is required").max(1000),
  }),
  handler(ctx, input) {
    const d = loadFor(ctx, input.disputeId);
    expectStatus(d, "submitted");
    ctx.db.prepare("UPDATE disputes SET status = ?, decided_at = ? WHERE id = ?").run(input.outcome, now(), d.id);
    ctx.audit({ before: { status: d.status }, after: { status: input.outcome } });
    return { id: d.id, status: input.outcome };
  },
});

const acceptLossApproval: ApprovalKind = {
  permission: "disputes:approve_loss",
  onApprove(ctx) {
    const d = load(ctx.approval.entity_id, ctx.db);
    expectStatus(d, "needs_response");
    if (d.approval_id !== ctx.approval.id) throw new InvalidStateError(`Approval ${ctx.approval.id} is not the one pending on ${d.id}`);
    ctx.db.prepare("UPDATE disputes SET status = 'accepted', decided_at = ? WHERE id = ?").run(now(), d.id);
    ctx.audit({ before: { status: d.status }, after: { status: "accepted" } });
  },
  onReject(ctx) {
    const d = load(ctx.approval.entity_id, ctx.db);
    expectStatus(d, "needs_response");
    if (d.approval_id !== ctx.approval.id) throw new InvalidStateError(`Approval ${ctx.approval.id} is not the one pending on ${d.id}`);
    ctx.db.prepare("UPDATE disputes SET approval_id = NULL WHERE id = ?").run(d.id);
    ctx.audit({ before: { status: d.status, approvalId: d.approval_id }, after: { status: d.status, approvalId: null } });
  },
};

export const approvals = { accept_loss: acceptLossApproval } satisfies Record<string, ApprovalKind>;
