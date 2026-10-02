import { getDb, listAudit, mask, type Approval, type Db, type User } from "@/platform";
import { HIGH_RISK_SCORE, REVEAL_WINDOW_MS, TOOL } from "./manifest";

export type KycStatus = "open" | "claimed" | "pending_lead_review" | "approved" | "rejected";
export const KYC_STATUSES: readonly KycStatus[] = ["open", "claimed", "pending_lead_review", "approved", "rejected"];

export const PII_FIELDS = ["date_of_birth", "document_number"] as const;
export type PiiField = (typeof PII_FIELDS)[number];

/** A case as stored. Only actions and `getCaseRow` see PII in the clear. */
export interface KycCaseRow {
  id: string;
  applicant_name: string;
  date_of_birth: string;
  country: string;
  document_number: string;
  risk_score: number;
  watchlist_hit: 0 | 1;
  status: KycStatus;
  assignee_id: string | null;
  recommendation_reason: string | null;
  approval_id: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  created_at: string;
  claimed_at: string | null;
  decided_at: string | null;
}

/** What pages get: PII masked unless the user revealed it recently. */
export interface KycCase extends KycCaseRow {
  high_risk: boolean;
  pii_revealed: boolean;
}

export interface KycCaseDetail {
  kycCase: KycCase;
  approval: Approval | null;
}

export function isHighRisk(c: Pick<KycCaseRow, "risk_score" | "watchlist_hit">): boolean {
  return c.risk_score >= HIGH_RISK_SCORE || c.watchlist_hit === 1;
}

/** Raw row, PII in the clear. For actions; pages go through `listCases` / `getCaseDetail`. */
export function getCaseRow(id: string, db: Db = getDb()): KycCaseRow | null {
  return (db.prepare("SELECT * FROM kyc_cases WHERE id = ?").get(id) as unknown as KycCaseRow | undefined) ?? null;
}

function maskRow(row: KycCaseRow, revealed: boolean): KycCase {
  return {
    ...row,
    date_of_birth: revealed ? row.date_of_birth : mask(row.date_of_birth, 2),
    document_number: revealed ? row.document_number : mask(row.document_number, 3),
    high_risk: isHighRisk(row),
    pii_revealed: revealed,
  };
}

/**
 * True if `user` ran an `ok` `reveal_pii` action on this case within the reveal window.
 * The audit log is the record of reveals, so the detail page needs no extra state.
 */
export function hasRecentReveal(user: User, caseId: string, at: Date = new Date()): boolean {
  const cutoff = at.getTime() - REVEAL_WINDOW_MS;
  return listAudit({ tool: TOOL, entityId: caseId, actorId: user.id }).some(
    (a) => a.action === "reveal_pii" && a.outcome === "ok" && Date.parse(a.ts) >= cutoff,
  );
}

/** The queue: highest risk first. PII always masked here. */
export function listCases(filter: { status?: KycStatus; assigneeId?: string } = {}): KycCase[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.assigneeId) {
    where.push("assignee_id = ?");
    params.push(filter.assigneeId);
  }
  const sql = `SELECT * FROM kyc_cases
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY (risk_score >= ${HIGH_RISK_SCORE} OR watchlist_hit = 1) DESC, risk_score DESC, created_at ASC`;
  const rows = getDb().prepare(sql).all(...params) as unknown as KycCaseRow[];
  return rows.map((r) => maskRow(r, false));
}

export function getCase(id: string): KycCase | null {
  const row = getCaseRow(id);
  return row ? maskRow(row, false) : null;
}

/** Case plus its lead approval, with PII unmasked only after an audited reveal by `user`. */
export function getCaseDetail(id: string, user: User): KycCaseDetail | null {
  const db = getDb();
  const row = getCaseRow(id, db);
  if (!row) return null;
  const approval = row.approval_id
    ? ((db.prepare("SELECT * FROM approvals WHERE id = ?").get(row.approval_id) as unknown as Approval | undefined) ?? null)
    : null;
  return { kycCase: maskRow(row, hasRecentReveal(user, id)), approval };
}
