import { getDb, listApprovals, type Approval, type Charge, type Db } from "@/platform";

export type DisputeStatus = "needs_response" | "submitted" | "accepted" | "won" | "lost";
export const DISPUTE_STATUSES: readonly DisputeStatus[] = ["needs_response", "submitted", "accepted", "won", "lost"];

export type DisputeReason = "fraud" | "not_received" | "duplicate" | "other";
export const DISPUTE_REASONS: readonly DisputeReason[] = ["fraud", "not_received", "duplicate", "other"];

export type DisputeOutcome = Extract<DisputeStatus, "won" | "lost">;

export interface Dispute {
  id: string;
  charge_id: string;
  customer: string;
  amount_cents: number;
  reason: DisputeReason;
  /** Calendar date, YYYY-MM-DD. */
  response_deadline: string;
  status: DisputeStatus;
  /** The loss acceptance waiting on finance, if any. */
  approval_id: string | null;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
}

export interface DisputeNote {
  id: string;
  dispute_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface DisputeDetail {
  dispute: Dispute;
  charge: Charge;
  notes: DisputeNote[];
  /** Every loss-acceptance approval ever requested on this dispute, newest first. */
  approvals: Approval[];
}

/** Whole days from today (UTC) to the deadline. 0 is due today; negative is overdue. */
export function daysLeft(deadline: string, today: Date = new Date()): number {
  const due = Date.parse(`${deadline}T00:00:00Z`);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due - start) / 86_400_000);
}

/** Statuses the analyst still has work to do in. */
export function isOpen(status: DisputeStatus): boolean {
  return status === "needs_response" || status === "submitted";
}

/** The queue, soonest deadline first. */
export function listDisputes(filter: { status?: DisputeStatus } = {}): Dispute[] {
  const db = getDb();
  if (filter.status) {
    return db
      .prepare("SELECT * FROM disputes WHERE status = ? ORDER BY response_deadline ASC, created_at ASC")
      .all(filter.status) as unknown as Dispute[];
  }
  return db.prepare("SELECT * FROM disputes ORDER BY response_deadline ASC, created_at ASC").all() as unknown as Dispute[];
}

export function getDispute(id: string, db: Db = getDb()): Dispute | null {
  return (db.prepare("SELECT * FROM disputes WHERE id = ?").get(id) as unknown as Dispute | undefined) ?? null;
}

export function listNotes(disputeId: string, db: Db = getDb()): DisputeNote[] {
  return db
    .prepare("SELECT * FROM dispute_notes WHERE dispute_id = ? ORDER BY created_at ASC, id ASC")
    .all(disputeId) as unknown as DisputeNote[];
}

export function getDisputeDetail(id: string): DisputeDetail | null {
  const db = getDb();
  const dispute = getDispute(id, db);
  if (!dispute) return null;
  const charge = db.prepare("SELECT * FROM charges WHERE id = ?").get(dispute.charge_id) as unknown as Charge;
  return { dispute, charge, notes: listNotes(id, db), approvals: listApprovals({ tool: "disputes", entityId: id }) };
}
