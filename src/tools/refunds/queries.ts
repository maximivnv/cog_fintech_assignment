import { getDb, listCharges, type Approval, type Charge, type Db } from "@/platform";

export type RefundStatus = "pending_approval" | "executed" | "rejected";
export const REFUND_STATUSES: readonly RefundStatus[] = ["pending_approval", "executed", "rejected"];

export interface Refund {
  id: string;
  charge_id: string;
  amount_cents: number;
  reason: string;
  status: RefundStatus;
  requested_by: string;
  approval_id: string | null;
  payment_refund_id: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface RefundDetail {
  refund: Refund;
  charge: Charge;
  approval: Approval | null;
}

export interface ChargeWithRemaining extends Charge {
  pending_cents: number;
  remaining_cents: number;
}

export function listRefunds(filter: { status?: RefundStatus } = {}): Refund[] {
  const db = getDb();
  if (filter.status) {
    return db.prepare("SELECT * FROM refunds WHERE status = ? ORDER BY created_at DESC").all(filter.status) as unknown as Refund[];
  }
  return db.prepare("SELECT * FROM refunds ORDER BY created_at DESC").all() as unknown as Refund[];
}

export function getRefund(id: string, db: Db = getDb()): Refund | null {
  return (db.prepare("SELECT * FROM refunds WHERE id = ?").get(id) as unknown as Refund | undefined) ?? null;
}

export function getRefundDetail(id: string): RefundDetail | null {
  const db = getDb();
  const refund = getRefund(id, db);
  if (!refund) return null;
  const charge = db.prepare("SELECT * FROM charges WHERE id = ?").get(refund.charge_id) as unknown as Charge;
  const approval = refund.approval_id
    ? ((db.prepare("SELECT * FROM approvals WHERE id = ?").get(refund.approval_id) as unknown as Approval | undefined) ?? null)
    : null;
  return { refund, charge, approval };
}

/** Cents tied up in refunds that are still waiting for a decision. */
export function pendingCents(chargeId: string, db: Db = getDb()): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM refunds WHERE charge_id = ? AND status = 'pending_approval'")
    .get(chargeId) as { n: number };
  return row.n;
}

/** What can still be refunded on a charge, counting pending requests. */
export function remainingCents(charge: Charge, db: Db = getDb()): number {
  return charge.amount_cents - charge.refunded_cents - pendingCents(charge.id, db);
}

export function listChargesWithRemaining(): ChargeWithRemaining[] {
  const db = getDb();
  return listCharges().map((c) => {
    const pending = pendingCents(c.id, db);
    return { ...c, pending_cents: pending, remaining_cents: c.amount_cents - c.refunded_cents - pending };
  });
}
