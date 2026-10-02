import { z } from "zod";
import { writeAudit } from "./audit";
import { getDb, tx } from "./db";
import {
  InvalidInputError,
  InvalidStateError,
  NotFoundError,
  PermissionDeniedError,
  SeparationOfDutiesError,
} from "./errors";
import { newId, now } from "./ids";
import { can, getTool, type Db, type Permission } from "./registry";
import type { User } from "./users";

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type Decision = "approve" | "reject";

export interface Approval {
  id: string;
  tool: string;
  kind: string;
  entity_id: string;
  summary: string;
  permission: Permission;
  requested_by: string;
  status: ApprovalStatus;
  decided_by: string | null;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface ApprovalContext {
  user: User;
  db: Db;
  approval: Approval;
  reason: string;
  /** Attach before/after state to the decision's audit row. */
  audit(detail: Record<string, unknown>): void;
}

/** What a tool exports per approval kind: who may decide, and what happens on each decision. */
export interface ApprovalKind {
  permission: Permission;
  onApprove: (ctx: ApprovalContext) => void;
  onReject: (ctx: ApprovalContext) => void;
}

export interface RequestApprovalInput {
  kind: string;
  entityId: string;
  summary: string;
}

export function approvalKind(tool: string, kind: string): ApprovalKind {
  const def = getTool(tool)?.approvals?.[kind];
  if (!def) throw new NotFoundError(`Tool "${tool}" has no approval kind "${kind}"`);
  return def;
}

/** Called by `ctx.requestApproval` inside an action's transaction. */
export function createApproval(
  db: Db,
  input: RequestApprovalInput & { tool: string; requestedBy: User },
): string {
  const def = approvalKind(input.tool, input.kind);
  const id = newId("apr");
  db.prepare(
    `INSERT INTO approvals
       (id, tool, kind, entity_id, summary, permission, requested_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(id, input.tool, input.kind, input.entityId, input.summary, def.permission, input.requestedBy.id, now());
  return id;
}

export function getApproval(id: string): Approval | null {
  return (getDb().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as unknown as Approval | undefined) ?? null;
}

export function listApprovals(filter: { status?: ApprovalStatus; tool?: string; entityId?: string } = {}): Approval[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.tool) {
    where.push("tool = ?");
    params.push(filter.tool);
  }
  if (filter.entityId) {
    where.push("entity_id = ?");
    params.push(filter.entityId);
  }
  const sql = `SELECT * FROM approvals ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC`;
  return getDb().prepare(sql).all(...params) as unknown as Approval[];
}

/** Pending approvals this user holds the permission for and did not request. */
export function approvalsToDecide(user: User): Approval[] {
  return listApprovals({ status: "pending" }).filter(
    (a) => a.requested_by !== user.id && can(user, a.permission),
  );
}

export function approvalsRequestedBy(user: User): Approval[] {
  return listApprovals().filter((a) => a.requested_by === user.id);
}

export function canDecide(user: User, approval: Approval): boolean {
  return (
    approval.status === "pending" && approval.requested_by !== user.id && can(user, approval.permission)
  );
}

const decisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

/**
 * Decide a pending approval. The decider needs the approval's permission and must not be the
 * requester (enforced here and by the `CHECK (decided_by <> requested_by)` constraint).
 * Runs the tool's `onApprove`/`onReject` in the same transaction. Audited.
 */
export async function decideApproval(
  user: User,
  id: string,
  decision: Decision,
  reason: string,
): Promise<Approval> {
  const parsed = decisionSchema.safeParse({ id, decision, reason });
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.issues.map((i) => i.message));
  }
  const input = parsed.data;
  const action = `approval.${input.decision}`;

  const approval = getApproval(input.id);
  if (!approval) throw new NotFoundError(`Approval ${input.id} not found`);

  const deny = (reasonText: string, err: Error): never => {
    writeAudit({
      actorId: user.id,
      tool: approval.tool,
      action,
      entityId: approval.entity_id,
      detail: { approvalId: approval.id, reason: reasonText },
      outcome: "denied",
    });
    throw err;
  };

  if (!can(user, approval.permission)) {
    deny(
      `missing permission ${approval.permission}`,
      new PermissionDeniedError(`${user.name} lacks ${approval.permission}, required to decide this approval`),
    );
  }
  if (approval.requested_by === user.id) {
    deny("requester cannot decide own approval", new SeparationOfDutiesError());
  }
  if (approval.status !== "pending") {
    throw new InvalidStateError(`Approval ${approval.id} is already ${approval.status}`);
  }

  const kind = approvalKind(approval.tool, approval.kind);
  let extra: Record<string, unknown> = {};
  try {
    return tx((db) => {
      const status: ApprovalStatus = input.decision === "approve" ? "approved" : "rejected";
      const changed = db
        .prepare(
          `UPDATE approvals SET status = ?, decided_by = ?, reason = ?, decided_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(status, user.id, input.reason, now(), approval.id).changes;
      if (changed !== 1) throw new InvalidStateError(`Approval ${approval.id} is no longer pending`);

      const updated = db.prepare("SELECT * FROM approvals WHERE id = ?").get(approval.id) as unknown as Approval;
      const ctx: ApprovalContext = {
        user,
        db,
        approval: updated,
        reason: input.reason,
        audit(d) {
          extra = { ...extra, ...d };
        },
      };
      if (input.decision === "approve") kind.onApprove(ctx);
      else kind.onReject(ctx);

      writeAudit(
        {
          actorId: user.id,
          tool: approval.tool,
          action,
          entityId: approval.entity_id,
          detail: {
            approvalId: approval.id,
            kind: approval.kind,
            requestedBy: approval.requested_by,
            reason: input.reason,
            ...extra,
          },
          outcome: "ok",
        },
        db,
      );
      return updated;
    });
  } catch (err) {
    writeAudit({
      actorId: user.id,
      tool: approval.tool,
      action,
      entityId: approval.entity_id,
      detail: {
        approvalId: approval.id,
        reason: input.reason,
        error: err instanceof Error ? err.message : String(err),
      },
      outcome: "failed",
    });
    throw err;
  }
}
