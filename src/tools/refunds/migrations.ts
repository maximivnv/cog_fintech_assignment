import type { Db } from "@/platform";

export const migrations: readonly string[] = [
  `CREATE TABLE refunds (
    id TEXT PRIMARY KEY,
    charge_id TEXT NOT NULL REFERENCES charges (id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending_approval', 'executed', 'rejected')),
    requested_by TEXT NOT NULL,
    approval_id TEXT REFERENCES approvals (id),
    payment_refund_id TEXT REFERENCES payment_refunds (id),
    created_at TEXT NOT NULL,
    decided_at TEXT
  )`,
  `CREATE INDEX refunds_status ON refunds (status)`,
  `CREATE INDEX refunds_charge ON refunds (charge_id)`,
];

type SeedRow = {
  id: string;
  chargeId: string;
  amountCents: number;
  reason: string;
  requestedBy: string;
  status: "pending_approval" | "executed" | "rejected";
  decidedBy?: string;
  decisionReason?: string;
};

const SEED: readonly SeedRow[] = [
  { id: "rf_seed_1", chargeId: "ch_1001", amountCents: 25_000, reason: "Customer downgraded mid-year", requestedBy: "u_ana", status: "pending_approval" },
  { id: "rf_seed_2", chargeId: "ch_1002", amountCents: 12_000, reason: "Damaged on arrival, partial credit", requestedBy: "u_rio", status: "pending_approval" },
  { id: "rf_seed_3", chargeId: "ch_1007", amountCents: 150_000, reason: "Duplicate order", requestedBy: "u_ana", status: "pending_approval" },
  { id: "rf_seed_4", chargeId: "ch_1005", amountCents: 7_500, reason: "Billed after cancellation", requestedBy: "u_ana", status: "executed" },
  { id: "rf_seed_5", chargeId: "ch_1006", amountCents: 20_000, reason: "Seats unused", requestedBy: "u_ana", status: "rejected", decidedBy: "u_ben", decisionReason: "Seats were provisioned and logged in" },
];

/** Fake data: a few pending, one executed, one rejected. */
export function seed(db: Db): void {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM refunds").get() as { n: number };
  if (n > 0) return;

  const insertRefund = db.prepare(
    `INSERT INTO refunds (id, charge_id, amount_cents, reason, status, requested_by, approval_id, payment_refund_id, created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertApproval = db.prepare(
    `INSERT INTO approvals (id, tool, kind, entity_id, summary, permission, requested_by, status, decided_by, reason, created_at, decided_at)
     VALUES (?, 'refunds', 'refund', ?, ?, 'refunds:approve', ?, ?, ?, ?, ?, ?)`,
  );
  const insertPaymentRefund = db.prepare(
    "INSERT INTO payment_refunds (id, charge_id, amount_cents, created_at) VALUES (?, ?, ?, ?)",
  );
  const bumpCharge = db.prepare("UPDATE charges SET refunded_cents = refunded_cents + ? WHERE id = ?");

  SEED.forEach((r, i) => {
    const createdAt = new Date(Date.UTC(2025, 1, 3 + i, 10, 15)).toISOString();
    const decidedAt = r.status === "pending_approval" ? null : new Date(Date.UTC(2025, 1, 4 + i, 14, 0)).toISOString();
    let approvalId: string | null = null;
    let paymentRefundId: string | null = null;

    if (r.status === "executed") {
      paymentRefundId = `re_${r.id}`;
      insertPaymentRefund.run(paymentRefundId, r.chargeId, r.amountCents, createdAt);
      bumpCharge.run(r.amountCents, r.chargeId);
    } else {
      approvalId = `apr_${r.id}`;
      insertApproval.run(
        approvalId,
        r.id,
        `Refund ${(r.amountCents / 100).toFixed(2)} USD on ${r.chargeId}: ${r.reason}`,
        r.requestedBy,
        r.status === "pending_approval" ? "pending" : "rejected",
        r.decidedBy ?? null,
        r.decisionReason ?? null,
        createdAt,
        decidedAt,
      );
    }
    insertRefund.run(r.id, r.chargeId, r.amountCents, r.reason, r.status, r.requestedBy, approvalId, paymentRefundId, createdAt, decidedAt);
  });
}
