import type { Db } from "@/platform";

export const migrations: readonly string[] = [
  `CREATE TABLE disputes (
    id TEXT PRIMARY KEY,
    charge_id TEXT NOT NULL REFERENCES charges (id),
    customer TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL CHECK (reason IN ('fraud', 'not_received', 'duplicate', 'other')),
    response_deadline TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('needs_response', 'submitted', 'accepted', 'won', 'lost')),
    approval_id TEXT REFERENCES approvals (id),
    created_at TEXT NOT NULL,
    submitted_at TEXT,
    decided_at TEXT
  )`,
  `CREATE INDEX disputes_status ON disputes (status)`,
  `CREATE INDEX disputes_deadline ON disputes (response_deadline)`,
  `CREATE TABLE dispute_notes (
    id TEXT PRIMARY KEY,
    dispute_id TEXT NOT NULL REFERENCES disputes (id),
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX dispute_notes_dispute ON dispute_notes (dispute_id, created_at)`,
];

type SeedRow = {
  id: string;
  chargeId: string;
  customer: string;
  amountCents: number;
  reason: "fraud" | "not_received" | "duplicate" | "other";
  /** Days from today; negative is overdue. */
  deadlineInDays: number;
  status: "needs_response" | "submitted" | "accepted" | "won" | "lost";
  notes?: readonly [author: string, body: string][];
  /** A pending loss acceptance waiting on finance. */
  pendingAcceptBy?: string;
};

const SEED: readonly SeedRow[] = [
  { id: "dp_seed_1", chargeId: "ch_1004", customer: "Tomás Herrera", amountCents: 750_000, reason: "fraud", deadlineInDays: 2, status: "needs_response", notes: [["u_ana", "Card present, chip read. Requesting signed delivery slip from account manager."]] },
  { id: "dp_seed_2", chargeId: "ch_1002", customer: "Marcus Webb", amountCents: 45_999, reason: "not_received", deadlineInDays: 5, status: "needs_response" },
  { id: "dp_seed_3", chargeId: "ch_1007", customer: "Hannah Lind", amountCents: 189_900, reason: "duplicate", deadlineInDays: -1, status: "needs_response", notes: [["u_rio", "Two orders #4502 and #4503 placed 40s apart. Checking whether both shipped."]] },
  { id: "dp_seed_4", chargeId: "ch_1008", customer: "Noor Haddad", amountCents: 120_000, reason: "other", deadlineInDays: 9, status: "needs_response", notes: [["u_ana", "Customer says the annual plan was cancelled before renewal. No cancellation ticket found."]], pendingAcceptBy: "u_ana" },
  { id: "dp_seed_5", chargeId: "ch_1001", customer: "Priya Natarajan", amountCents: 120_000, reason: "not_received", deadlineInDays: 12, status: "submitted", notes: [["u_ana", "Login history shows daily use since purchase."], ["u_ana", "Attached invoice and access logs."]] },
  { id: "dp_seed_6", chargeId: "ch_1003", customer: "Lena Fischer", amountCents: 4_900, reason: "other", deadlineInDays: -6, status: "accepted", notes: [["u_rio", "Below the threshold; not worth contesting."]] },
  { id: "dp_seed_7", chargeId: "ch_1006", customer: "Samuel Okafor", amountCents: 32_500, reason: "fraud", deadlineInDays: -20, status: "won", notes: [["u_ana", "3DS authenticated. Liability shift applies."]] },
  { id: "dp_seed_8", chargeId: "ch_1005", customer: "Aiko Tanaka", amountCents: 9_900, reason: "duplicate", deadlineInDays: -14, status: "lost", notes: [["u_rio", "Two charges on the same day; could not show both were intentional."]] },
];

function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/** Fake data: a queue with mixed deadlines, one loss waiting on finance, and one of each closed status. */
export function seed(db: Db): void {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM disputes").get() as { n: number };
  if (n > 0) return;

  const insertDispute = db.prepare(
    `INSERT INTO disputes (id, charge_id, customer, amount_cents, reason, response_deadline, status, approval_id, created_at, submitted_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertNote = db.prepare(
    "INSERT INTO dispute_notes (id, dispute_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertApproval = db.prepare(
    `INSERT INTO approvals (id, tool, kind, entity_id, summary, permission, requested_by, status, created_at)
     VALUES (?, 'disputes', 'accept_loss', ?, ?, 'disputes:approve_loss', ?, 'pending', ?)`,
  );

  SEED.forEach((d, i) => {
    const createdAt = new Date(Date.UTC(2025, 1, 3 + i, 9, 30)).toISOString();
    const submittedAt = d.status === "needs_response" || d.status === "accepted" ? null : new Date(Date.UTC(2025, 1, 5 + i, 11, 0)).toISOString();
    const decidedAt = d.status === "needs_response" || d.status === "submitted" ? null : new Date(Date.UTC(2025, 1, 9 + i, 16, 45)).toISOString();
    let approvalId: string | null = null;
    if (d.pendingAcceptBy) {
      approvalId = `apr_${d.id}`;
      insertApproval.run(
        approvalId,
        d.id,
        `Accept loss of ${(d.amountCents / 100).toFixed(2)} USD on dispute ${d.id} (${d.customer})`,
        d.pendingAcceptBy,
        new Date(Date.UTC(2025, 1, 6 + i, 12, 0)).toISOString(),
      );
    }
    insertDispute.run(d.id, d.chargeId, d.customer, d.amountCents, d.reason, isoDate(d.deadlineInDays), d.status, approvalId, createdAt, submittedAt, decidedAt);
    (d.notes ?? []).forEach(([author, body], j) => {
      insertNote.run(`dn_${d.id}_${j}`, d.id, author, body, new Date(Date.UTC(2025, 1, 4 + i, 10 + j, 0)).toISOString());
    });
  });
}
