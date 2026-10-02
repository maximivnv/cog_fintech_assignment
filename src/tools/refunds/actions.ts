import { z } from "zod";
import {
  InvalidStateError,
  NotFoundError,
  defineAction,
  formatCents,
  getCharge,
  newId,
  now,
  refund,
  type ApprovalKind,
} from "@/platform";
import { AUTO_APPROVE_CENTS, MAX_CENTS, TOOL } from "./manifest";
import { getRefund, remainingCents } from "./queries";

/**
 * Ask for a refund on a charge. Up to the auto-approve threshold it executes right away;
 * above it a finance approver has to decide; above the max it is refused.
 */
export const requestRefund = defineAction({
  tool: TOOL,
  name: "request",
  permission: "refunds:request",
  input: z.object({
    chargeId: z.string().min(1),
    amountCents: z.number().int().positive(),
    reason: z.string().trim().min(1, "A reason is required").max(1000),
  }),
  handler(ctx, input) {
    const charge = getCharge(input.chargeId);
    if (!charge) throw new NotFoundError(`Charge ${input.chargeId} not found`);
    if (input.amountCents > MAX_CENTS) {
      throw new InvalidStateError(`Refunds over ${formatCents(MAX_CENTS)} are refused: escalate to finance`);
    }
    const remaining = remainingCents(charge, ctx.db);
    if (input.amountCents > remaining) {
      throw new InvalidStateError(
        `${formatCents(input.amountCents)} exceeds the ${formatCents(remaining)} left on ${charge.id} (counting pending requests)`,
      );
    }

    const id = newId("rf");
    const createdAt = now();
    const status = input.amountCents <= AUTO_APPROVE_CENTS ? "executed" : "pending_approval";
    let approvalId: string | null = null;
    let paymentRefundId: string | null = null;
    if (status === "executed") {
      paymentRefundId = refund(charge.id, input.amountCents);
    } else {
      approvalId = ctx.requestApproval({
        kind: "refund",
        entityId: id,
        summary: `Refund ${formatCents(input.amountCents)} on ${charge.id} (${charge.customer}): ${input.reason}`,
      });
    }
    ctx.db
      .prepare(
        `INSERT INTO refunds (id, charge_id, amount_cents, reason, status, requested_by, approval_id, payment_refund_id, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, charge.id, input.amountCents, input.reason, status, ctx.user.id, approvalId, paymentRefundId, createdAt, status === "executed" ? createdAt : null);
    ctx.audit({ entityId: id, after: { status, approvalId, paymentRefundId } });
    return { id, status };
  },
});

const refundApproval: ApprovalKind = {
  permission: "refunds:approve",
  onApprove(ctx) {
    const r = getRefund(ctx.approval.entity_id, ctx.db);
    if (!r) throw new NotFoundError(`Refund ${ctx.approval.entity_id} not found`);
    if (r.status !== "pending_approval") throw new InvalidStateError(`Refund ${r.id} is already ${r.status}`);
    const paymentRefundId = refund(r.charge_id, r.amount_cents);
    ctx.db
      .prepare("UPDATE refunds SET status = 'executed', payment_refund_id = ?, decided_at = ? WHERE id = ?")
      .run(paymentRefundId, now(), r.id);
    ctx.audit({ before: { status: r.status }, after: { status: "executed", paymentRefundId } });
  },
  onReject(ctx) {
    const r = getRefund(ctx.approval.entity_id, ctx.db);
    if (!r) throw new NotFoundError(`Refund ${ctx.approval.entity_id} not found`);
    if (r.status !== "pending_approval") throw new InvalidStateError(`Refund ${r.id} is already ${r.status}`);
    ctx.db.prepare("UPDATE refunds SET status = 'rejected', decided_at = ? WHERE id = ?").run(now(), r.id);
    ctx.audit({ before: { status: r.status }, after: { status: "rejected" } });
  },
};

export const approvals = { refund: refundApproval } satisfies Record<string, ApprovalKind>;
