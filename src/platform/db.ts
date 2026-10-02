import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { toolRegistry, type Db } from "./registry";

const PLATFORM_MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'failed'))
  )`,
  `CREATE INDEX IF NOT EXISTS audit_log_tool_ts ON audit_log (tool, ts)`,
  `CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (tool, entity_id)`,
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_update
     BEFORE UPDATE ON audit_log
   BEGIN
     SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE is not allowed');
   END`,
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
     BEFORE DELETE ON audit_log
   BEGIN
     SELECT RAISE(ABORT, 'audit_log is append-only: DELETE is not allowed');
   END`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    permission TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    CHECK (decided_by <> requested_by)
  )`,
  `CREATE INDEX IF NOT EXISTS approvals_status ON approvals (status)`,
  `CREATE TABLE IF NOT EXISTS charges (
    id TEXT PRIMARY KEY,
    customer TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    refunded_cents INTEGER NOT NULL DEFAULT 0
      CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS payment_refunds (
    id TEXT PRIMARY KEY,
    charge_id TEXT NOT NULL REFERENCES charges (id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL
  )`,
];

const SEED_CHARGES: ReadonlyArray<[string, string, string, number]> = [
  ["ch_1001", "Priya Natarajan", "Annual plan", 120000],
  ["ch_1002", "Marcus Webb", "Hardware order #4471", 45999],
  ["ch_1003", "Lena Fischer", "Monthly plan", 4900],
  ["ch_1004", "Tomás Herrera", "Consulting block", 750000],
  ["ch_1005", "Aiko Tanaka", "Monthly plan", 9900],
  ["ch_1006", "Samuel Okafor", "Add-on seats", 32500],
  ["ch_1007", "Hannah Lind", "Hardware order #4502", 189900],
  ["ch_1008", "Noor Haddad", "Annual plan", 240000],
];

function seedPlatform(db: Db): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM charges").get() as { n: number };
  if (row.n > 0) return;
  const insert = db.prepare(
    `INSERT INTO charges (id, customer, description, amount_cents, refunded_cents, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  );
  SEED_CHARGES.forEach(([id, customer, description, amount], i) => {
    const createdAt = new Date(Date.UTC(2025, 0, 10 + i, 9, 30)).toISOString();
    insert.run(id, customer, description, amount, createdAt);
  });
}

function applyMigration(db: Db, name: string, statements: readonly string[], seed?: (db: Db) => void) {
  const done = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(name);
  if (done) return;
  db.exec("BEGIN");
  try {
    for (const sql of statements) db.exec(sql);
    db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
      name,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  seed?.(db);
}

let db: Db | null = null;
const migratedTools = new Set<string>();

export function dbPath(): string {
  return process.env.DB_PATH ?? "data/app.db";
}

function open(): Db {
  const path = dbPath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const conn = new DatabaseSync(path);
  conn.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") conn.exec("PRAGMA journal_mode = WAL");
  conn.exec(PLATFORM_MIGRATIONS[0]);
  applyMigration(conn, "platform", PLATFORM_MIGRATIONS, seedPlatform);
  return conn;
}

/** Open (once) and migrate. Tools registered after the first call are migrated on the next call. */
export function getDb(): Db {
  if (!db) {
    db = open();
    migratedTools.clear();
  }
  for (const tool of toolRegistry) {
    const slug = tool.manifest.slug;
    if (migratedTools.has(slug)) continue;
    applyMigration(db, `tool:${slug}`, tool.migrations, tool.seed);
    migratedTools.add(slug);
  }
  return db;
}

/** Close the connection; the next `getDb()` reopens and re-migrates. Tests use this for a clean slate. */
export function closeDb(): void {
  db?.close();
  db = null;
  migratedTools.clear();
}

let depth = 0;

/** Run `fn` in a transaction. Nested calls join the outer transaction. */
export function tx<T>(fn: (db: Db) => T): T {
  const conn = getDb();
  if (depth > 0) {
    depth++;
    try {
      return fn(conn);
    } finally {
      depth--;
    }
  }
  conn.exec("BEGIN IMMEDIATE");
  depth = 1;
  try {
    const result = fn(conn);
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  } finally {
    depth = 0;
  }
}

export function inTx(): boolean {
  return depth > 0;
}
