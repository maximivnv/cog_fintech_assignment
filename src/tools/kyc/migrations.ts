import type { Db } from "@/platform";

export const migrations: readonly string[] = [
  `CREATE TABLE kyc_cases (
    id TEXT PRIMARY KEY,
    applicant_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    country TEXT NOT NULL,
    document_number TEXT NOT NULL,
    risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    watchlist_hit INTEGER NOT NULL DEFAULT 0 CHECK (watchlist_hit IN (0, 1)),
    status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'pending_lead_review', 'approved', 'rejected')),
    assignee_id TEXT,
    recommendation_reason TEXT,
    approval_id TEXT REFERENCES approvals (id),
    decided_by TEXT,
    decision_reason TEXT,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    decided_at TEXT,
    CHECK (status = 'open' OR assignee_id IS NOT NULL)
  )`,
  `CREATE INDEX kyc_cases_status ON kyc_cases (status)`,
  `CREATE INDEX kyc_cases_assignee ON kyc_cases (assignee_id)`,
];

type SeedRow = {
  id: string;
  name: string;
  dob: string;
  country: string;
  doc: string;
  score: number;
  watchlist?: boolean;
  status: "open" | "claimed" | "pending_lead_review" | "approved" | "rejected";
  assignee?: string;
  recommendationReason?: string;
  decidedBy?: string;
  decisionReason?: string;
};

/** Fake applicants. Nothing here belongs to a real person. */
const SEED: readonly SeedRow[] = [
  { id: "kyc_seed_01", name: "Mateo Alvarez", dob: "1988-03-14", country: "ES", doc: "ESP-48213377Q", score: 12, status: "open" },
  { id: "kyc_seed_02", name: "Yuki Nakamura", dob: "1995-11-02", country: "JP", doc: "TK0938471", score: 27, status: "open" },
  { id: "kyc_seed_03", name: "Fatima El-Sayed", dob: "1979-07-23", country: "EG", doc: "A21934876", score: 44, status: "open" },
  { id: "kyc_seed_04", name: "Oliver Brandt", dob: "1991-01-09", country: "DE", doc: "C01X00T47", score: 58, status: "open" },
  { id: "kyc_seed_05", name: "Chen Wei", dob: "1984-09-30", country: "SG", doc: "S8412345A", score: 71, status: "open" },
  { id: "kyc_seed_06", name: "Amara Okonkwo", dob: "1990-05-17", country: "NG", doc: "A50123456", score: 83, status: "open" },
  { id: "kyc_seed_07", name: "Lucas Moreau", dob: "1976-12-01", country: "FR", doc: "19FR77231", score: 35, watchlist: true, status: "open" },
  { id: "kyc_seed_08", name: "Sofia Petrova", dob: "1993-08-21", country: "BG", doc: "BG6422109", score: 92, watchlist: true, status: "open" },
  { id: "kyc_seed_09", name: "Daniel Kim", dob: "1987-02-11", country: "KR", doc: "M12345678", score: 19, status: "claimed", assignee: "u_cara" },
  { id: "kyc_seed_10", name: "Isabela Costa", dob: "1982-10-05", country: "BR", doc: "FD123456", score: 66, status: "claimed", assignee: "u_dev" },
  {
    id: "kyc_seed_11",
    name: "Hamza Qureshi",
    dob: "1989-04-28",
    country: "PK",
    doc: "AB1234567",
    score: 77,
    status: "pending_lead_review",
    assignee: "u_cara",
    recommendationReason: "Source of funds documented; adverse media was a name match only",
  },
  {
    id: "kyc_seed_12",
    name: "Emma Johansson",
    dob: "1996-06-19",
    country: "SE",
    doc: "59103728",
    score: 8,
    status: "approved",
    assignee: "u_cara",
    decidedBy: "u_cara",
    decisionReason: "Documents verified, low risk",
  },
  {
    id: "kyc_seed_13",
    name: "Viktor Horvath",
    dob: "1973-09-12",
    country: "HU",
    doc: "HU8812345",
    score: 88,
    watchlist: true,
    status: "rejected",
    assignee: "u_dev",
    decidedBy: "u_dev",
    decisionReason: "Confirmed sanctions-list match",
  },
];

/** Fake data: a queue of mixed-risk applicants, two claimed, one waiting on a lead, one approved, one rejected. */
export function seed(db: Db): void {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM kyc_cases").get() as { n: number };
  if (n > 0) return;

  const insertCase = db.prepare(
    `INSERT INTO kyc_cases (id, applicant_name, date_of_birth, country, document_number, risk_score, watchlist_hit, status,
       assignee_id, recommendation_reason, approval_id, decided_by, decision_reason, created_at, claimed_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertApproval = db.prepare(
    `INSERT INTO approvals (id, tool, kind, entity_id, summary, permission, requested_by, status, created_at)
     VALUES (?, 'kyc', 'high_risk_approval', ?, ?, 'kyc:approve_high_risk', ?, 'pending', ?)`,
  );

  SEED.forEach((c, i) => {
    const createdAt = new Date(Date.UTC(2025, 2, 1 + i, 9, 0)).toISOString();
    const claimedAt = c.assignee ? new Date(Date.UTC(2025, 2, 2 + i, 11, 30)).toISOString() : null;
    const decidedAt = c.decidedBy ? new Date(Date.UTC(2025, 2, 3 + i, 16, 45)).toISOString() : null;
    let approvalId: string | null = null;
    if (c.status === "pending_lead_review") {
      approvalId = `apr_${c.id}`;
      insertApproval.run(
        approvalId,
        c.id,
        `Approve high-risk KYC case ${c.id} (${c.name}, score ${c.score}): ${c.recommendationReason}`,
        c.assignee ?? null,
        claimedAt,
      );
    }
    insertCase.run(
      c.id,
      c.name,
      c.dob,
      c.country,
      c.doc,
      c.score,
      c.watchlist ? 1 : 0,
      c.status,
      c.assignee ?? null,
      c.recommendationReason ?? null,
      approvalId,
      c.decidedBy ?? null,
      c.decisionReason ?? null,
      createdAt,
      claimedAt,
      decidedAt,
    );
  });
}
