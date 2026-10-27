import { getDb } from "./db";
import { now } from "./ids";
import type { Db } from "./registry";

export type AuditOutcome = "ok" | "denied" | "failed";

export interface AuditRow {
  id: number;
  ts: string;
  actor_id: string;
  tool: string;
  action: string;
  entity_id: string | null;
  detail_json: string;
  outcome: AuditOutcome;
}

export interface AuditEntry {
  actorId: string;
  tool: string;
  action: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
  outcome: AuditOutcome;
}

/** Append one audit row. Pass `db` to write inside an open transaction. */
export function writeAudit(entry: AuditEntry, db: Db = getDb()): number {
  const result = db
    .prepare(
      `INSERT INTO audit_log (ts, actor_id, tool, action, entity_id, detail_json, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      now(),
      entry.actorId,
      entry.tool,
      entry.action,
      entry.entityId ?? null,
      JSON.stringify(entry.detail ?? {}),
      entry.outcome,
    );
  return Number(result.lastInsertRowid);
}

const DEFAULT_AUDIT_LIMIT = 200;

function parseAuditLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(n) || n <= 0 ? DEFAULT_AUDIT_LIMIT : n;
}

/** Default row cap for `listAudit`. Override with `AUDIT_LIMIT`. */
export const AUDIT_LIMIT = parseAuditLimit(process.env.AUDIT_LIMIT);

export interface AuditFilter {
  tool?: string;
  entityId?: string;
  actorId?: string;
  limit?: number;
}

export function listAudit(filter: AuditFilter = {}): AuditRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.tool) {
    where.push("tool = ?");
    params.push(filter.tool);
  }
  if (filter.entityId) {
    where.push("entity_id = ?");
    params.push(filter.entityId);
  }
  if (filter.actorId) {
    where.push("actor_id = ?");
    params.push(filter.actorId);
  }
  const sql = `SELECT * FROM audit_log
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY id DESC LIMIT ?`;
  params.push(filter.limit ?? AUDIT_LIMIT);
  return getDb().prepare(sql).all(...params) as unknown as AuditRow[];
}

export function listAuditTools(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT tool FROM audit_log ORDER BY tool")
    .all() as unknown as { tool: string }[];
  return rows.map((r) => r.tool);
}
