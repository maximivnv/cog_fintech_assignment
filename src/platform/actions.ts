import { z } from "zod";
import { writeAudit } from "./audit";
import { tx } from "./db";
import { InvalidInputError, PermissionDeniedError } from "./errors";
import { can, type Db, type Permission } from "./registry";
import { createApproval, type RequestApprovalInput } from "./approvals";
import type { User } from "./users";

export interface AuditDetail {
  entityId?: string;
  before?: unknown;
  after?: unknown;
  [key: string]: unknown;
}

export interface ActionContext {
  user: User;
  db: Db;
  tool: string;
  /** Attach an entity id and before/after state to the action's audit row. */
  audit(detail: AuditDetail): void;
  /** Create a pending approval for this tool. Returns the approval id. */
  requestApproval(input: RequestApprovalInput): string;
}

export interface ActionDef<I extends z.ZodType, R> {
  tool: string;
  name: string;
  permission: Permission;
  input: I;
  handler: (ctx: ActionContext, input: z.output<I>) => R;
}

export interface Action<I extends z.ZodType, R> {
  (user: User, rawInput: unknown): Promise<R>;
  readonly tool: string;
  readonly name: string;
  readonly permission: Permission;
  readonly input: I;
}

export type AnyAction = Action<z.ZodType, unknown>;

/** Every action defined anywhere, so tests can enumerate them. */
export const actionRegistry: AnyAction[] = [];

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.map(String).join(".");
    return path ? `${path}: ${i.message}` : i.message;
  });
}

/**
 * The only way a tool writes to the database. Checks the permission, validates the input,
 * runs the handler in a transaction and writes the audit row in that same transaction.
 * Denied and failed calls are audited outside the rolled-back transaction.
 */
export function defineAction<I extends z.ZodType, R>(def: ActionDef<I, R>): Action<I, R> {
  const actionName = `${def.tool}.${def.name}`;

  const run = async (user: User, rawInput: unknown): Promise<R> => {
    if (!can(user, def.permission)) {
      writeAudit({
        actorId: user.id,
        tool: def.tool,
        action: def.name,
        detail: { reason: `missing permission ${def.permission}` },
        outcome: "denied",
      });
      throw new PermissionDeniedError(
        `${user.name} lacks ${def.permission}, required for ${actionName}`,
      );
    }

    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) {
      const issues = formatIssues(parsed.error);
      writeAudit({
        actorId: user.id,
        tool: def.tool,
        action: def.name,
        detail: { error: "invalid input", issues },
        outcome: "failed",
      });
      throw new InvalidInputError(issues);
    }
    const input = parsed.data as z.output<I>;

    let detail: AuditDetail = {};
    const approvalIds: string[] = [];
    try {
      return tx((db) => {
        const ctx: ActionContext = {
          user,
          db,
          tool: def.tool,
          audit(d) {
            detail = { ...detail, ...d };
          },
          requestApproval(req) {
            const id = createApproval(db, { ...req, tool: def.tool, requestedBy: user });
            approvalIds.push(id);
            return id;
          },
        };
        const result = def.handler(ctx, input);
        const { entityId, ...rest } = detail;
        writeAudit(
          {
            actorId: user.id,
            tool: def.tool,
            action: def.name,
            entityId,
            detail: {
              input,
              ...rest,
              ...(approvalIds.length ? { approvalIds } : {}),
            },
            outcome: "ok",
          },
          db,
        );
        return result;
      });
    } catch (err) {
      writeAudit({
        actorId: user.id,
        tool: def.tool,
        action: def.name,
        entityId: detail.entityId,
        detail: { input, error: err instanceof Error ? err.message : String(err) },
        outcome: "failed",
      });
      throw err;
    }
  };

  const action = Object.defineProperties(run, {
    tool: { value: def.tool, enumerable: true },
    name: { value: def.name, enumerable: true },
    permission: { value: def.permission, enumerable: true },
    input: { value: def.input, enumerable: true },
  }) as Action<I, R>;
  actionRegistry.push(action as AnyAction);
  return action;
}
