import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  InvalidInputError,
  InvalidStateError,
  PermissionDeniedError,
  SeparationOfDutiesError,
  actionRegistry,
  can,
  closeDb,
  decideApproval,
  defineAction,
  findUser,
  getApproval,
  getCharge,
  getDb,
  listAudit,
  refund,
  registerTool,
  tx,
  type ApprovalKind,
  type ToolModule,
  type User,
} from "@/platform";

const ana = findUser("u_ana")!; // support_agent
const ben = findUser("u_ben")!; // finance_approver
const rio = findUser("u_rio")!; // support_agent + finance_approver
const eve = findUser("u_eve")!; // auditor
const nobody: User = { id: "u_nobody", name: "Nobody", roles: [] };

const widgetApproval: ApprovalKind = {
  permission: "widgets:approve",
  onApprove(ctx) {
    ctx.db.prepare("UPDATE widgets SET status = 'approved' WHERE id = ?").run(ctx.approval.entity_id);
    ctx.audit({ after: { status: "approved" } });
  },
  onReject(ctx) {
    ctx.db.prepare("UPDATE widgets SET status = 'rejected' WHERE id = ?").run(ctx.approval.entity_id);
  },
};

const widgets: ToolModule = {
  manifest: {
    slug: "widgets",
    name: "Widgets",
    permissions: {
      "widgets:view": ["support_agent", "finance_approver", "auditor"],
      "widgets:request": ["support_agent"],
      "widgets:approve": ["finance_approver"],
    },
  },
  migrations: [
    `CREATE TABLE widgets (
       id TEXT PRIMARY KEY,
       amount_cents INTEGER NOT NULL,
       status TEXT NOT NULL
     )`,
  ],
  approvals: { widget: widgetApproval },
};
registerTool(widgets);

const requestWidget = defineAction({
  tool: "widgets",
  name: "request",
  permission: "widgets:request",
  input: z.object({ id: z.string().min(1), amountCents: z.number().int().positive() }),
  handler(ctx, input) {
    const status = input.amountCents > 10_000 ? "pending_approval" : "done";
    ctx.db.prepare("INSERT INTO widgets (id, amount_cents, status) VALUES (?, ?, ?)").run(input.id, input.amountCents, status);
    ctx.audit({ entityId: input.id, after: { status } });
    if (status === "pending_approval") {
      ctx.requestApproval({ kind: "widget", entityId: input.id, summary: `Widget ${input.id}` });
    }
    return { id: input.id, status };
  },
});

const explode = defineAction({
  tool: "widgets",
  name: "explode",
  permission: "widgets:request",
  input: z.object({ id: z.string() }),
  handler(ctx, input) {
    ctx.db.prepare("INSERT INTO widgets (id, amount_cents, status) VALUES (?, 1, 'done')").run(input.id);
    ctx.audit({ entityId: input.id });
    throw new Error("boom");
  },
});

const refundCharge = defineAction({
  tool: "widgets",
  name: "refund",
  permission: "widgets:approve",
  input: z.object({ chargeId: z.string(), amountCents: z.number().int() }),
  handler(ctx, input) {
    return refund(input.chargeId, input.amountCents);
  },
});

function widget(id: string) {
  return getDb().prepare("SELECT * FROM widgets WHERE id = ?").get(id) as { status: string } | undefined;
}

beforeEach(() => {
  closeDb();
});

describe("database", () => {
  it("migrates the platform and registered tools, and seeds charges", () => {
    const db = getDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["audit_log", "approvals", "charges", "widgets"]));
    expect((db.prepare("SELECT COUNT(*) AS n FROM charges").get() as { n: number }).n).toBeGreaterThan(0);
  });

  it("tx rolls back on error and joins nested transactions", () => {
    expect(() =>
      tx((db) => {
        db.prepare("INSERT INTO widgets (id, amount_cents, status) VALUES ('w_tx', 1, 'done')").run();
        tx(() => {
          throw new Error("inner");
        });
      }),
    ).toThrow("inner");
    expect(widget("w_tx")).toBeUndefined();
  });
});

describe("audit log", () => {
  it("rows cannot be updated", async () => {
    await requestWidget(ana, { id: "w_1", amountCents: 500 });
    const db = getDb();
    expect(() => db.prepare("UPDATE audit_log SET outcome = 'denied'").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE audit_log SET detail_json = '{}' WHERE id = 1").run()).toThrow(/append-only/);
    expect(listAudit()[0].outcome).toBe("ok");
  });

  it("rows cannot be deleted", async () => {
    await requestWidget(ana, { id: "w_1", amountCents: 500 });
    const db = getDb();
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log WHERE id = 1").run()).toThrow(/append-only/);
    expect(listAudit()).toHaveLength(1);
  });

  it("can be filtered by tool and entity", async () => {
    await requestWidget(ana, { id: "w_1", amountCents: 500 });
    await requestWidget(ana, { id: "w_2", amountCents: 500 });
    expect(listAudit({ tool: "widgets" })).toHaveLength(2);
    expect(listAudit({ tool: "other" })).toHaveLength(0);
    expect(listAudit({ entityId: "w_2" }).map((r) => r.entity_id)).toEqual(["w_2"]);
  });
});

describe("permissions", () => {
  it("can() follows the tool manifest", () => {
    expect(can(ana, "widgets:request")).toBe(true);
    expect(can(ana, "widgets:approve")).toBe(false);
    expect(can(ben, "widgets:approve")).toBe(true);
    expect(can(rio, "widgets:approve")).toBe(true);
    expect(can(eve, "widgets:view")).toBe(true);
    expect(can(eve, "widgets:request")).toBe(false);
    expect(can(nobody, "widgets:view")).toBe(false);
    expect(can(null, "widgets:view")).toBe(false);
    expect(can(ana, "unknown:thing")).toBe(false);
  });
});

describe("defineAction", () => {
  it("registers every action", () => {
    expect(actionRegistry).toEqual(expect.arrayContaining([requestWidget, explode, refundCharge]));
    expect(requestWidget.tool).toBe("widgets");
    expect(requestWidget.name).toBe("request");
    expect(requestWidget.permission).toBe("widgets:request");
  });

  it("runs the handler and writes an ok audit row with ctx.audit detail", async () => {
    const result = await requestWidget(ana, { id: "w_1", amountCents: 500 });
    expect(result).toEqual({ id: "w_1", status: "done" });
    expect(widget("w_1")?.status).toBe("done");

    const [row] = listAudit();
    expect(row).toMatchObject({ actor_id: "u_ana", tool: "widgets", action: "request", entity_id: "w_1", outcome: "ok" });
    expect(JSON.parse(row.detail_json)).toMatchObject({ input: { id: "w_1", amountCents: 500 }, after: { status: "done" } });
  });

  it("refuses a user without the permission and audits the denial", async () => {
    await expect(requestWidget(ben, { id: "w_1", amountCents: 500 })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(requestWidget(nobody, { id: "w_1", amountCents: 500 })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(widget("w_1")).toBeUndefined();

    const rows = listAudit();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.outcome)).toEqual(["denied", "denied"]);
    expect(rows.map((r) => r.actor_id)).toEqual(["u_nobody", "u_ben"]);
    expect(JSON.parse(rows[0].detail_json).reason).toContain("widgets:request");
  });

  it("checks the permission before looking at the input", async () => {
    await expect(requestWidget(nobody, "garbage")).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(listAudit()[0].outcome).toBe("denied");
  });

  it("rejects invalid input, writes nothing and audits the failure", async () => {
    await expect(requestWidget(ana, { id: "", amountCents: 500 })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(requestWidget(ana, { id: "w_1", amountCents: 12.5 })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(requestWidget(ana, { id: "w_1", amountCents: -1 })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(requestWidget(ana, { id: "w_1" })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(requestWidget(ana, null)).rejects.toBeInstanceOf(InvalidInputError);
    expect(widget("w_1")).toBeUndefined();

    const rows = listAudit();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.outcome === "failed")).toBe(true);
    expect(JSON.parse(rows[0].detail_json).error).toBe("invalid input");
  });

  it("rolls back the transaction when the handler throws and audits the failure", async () => {
    await expect(explode(ana, { id: "w_boom" })).rejects.toThrow("boom");
    expect(widget("w_boom")).toBeUndefined();

    const rows = listAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "explode", entity_id: "w_boom", outcome: "failed" });
    expect(JSON.parse(rows[0].detail_json).error).toBe("boom");
  });
});

describe("approvals", () => {
  async function pendingFrom(requester: User, id = "w_big") {
    await requestWidget(requester, { id, amountCents: 25_000 });
    const detail = JSON.parse(listAudit({ entityId: id })[0].detail_json) as { approvalIds: string[] };
    return getApproval(detail.approvalIds[0])!;
  }

  it("requestApproval creates a pending approval with the kind's permission", async () => {
    const approval = await pendingFrom(ana);
    expect(approval).toMatchObject({
      tool: "widgets",
      kind: "widget",
      entity_id: "w_big",
      permission: "widgets:approve",
      requested_by: "u_ana",
      status: "pending",
      decided_by: null,
    });
    expect(widget("w_big")?.status).toBe("pending_approval");
  });

  it("an approver runs onApprove in the same transaction and audits it", async () => {
    const approval = await pendingFrom(ana);
    const decided = await decideApproval(ben, approval.id, "approve", "Looks fine");
    expect(decided).toMatchObject({ status: "approved", decided_by: "u_ben", reason: "Looks fine" });
    expect(widget("w_big")?.status).toBe("approved");

    const [row] = listAudit();
    expect(row).toMatchObject({ actor_id: "u_ben", tool: "widgets", action: "approval.approve", entity_id: "w_big", outcome: "ok" });
    expect(JSON.parse(row.detail_json)).toMatchObject({ approvalId: approval.id, reason: "Looks fine", after: { status: "approved" } });
  });

  it("reject runs onReject", async () => {
    const approval = await pendingFrom(ana);
    await decideApproval(ben, approval.id, "reject", "No");
    expect(getApproval(approval.id)?.status).toBe("rejected");
    expect(widget("w_big")?.status).toBe("rejected");
  });

  it("the requester cannot decide their own approval, even with the approver role", async () => {
    const approval = await pendingFrom(rio);
    expect(can(rio, approval.permission)).toBe(true);

    await expect(decideApproval(rio, approval.id, "approve", "Self-approve")).rejects.toBeInstanceOf(SeparationOfDutiesError);
    expect(getApproval(approval.id)).toMatchObject({ status: "pending", decided_by: null });
    expect(widget("w_big")?.status).toBe("pending_approval");

    const [row] = listAudit();
    expect(row).toMatchObject({ actor_id: "u_rio", action: "approval.approve", entity_id: "w_big", outcome: "denied" });
    expect(JSON.parse(row.detail_json).reason).toMatch(/own approval/);
  });

  it("the database refuses decided_by = requested_by", async () => {
    const approval = await pendingFrom(ana);
    const db = getDb();
    expect(() =>
      db.prepare("UPDATE approvals SET status = 'approved', decided_by = requested_by WHERE id = ?").run(approval.id),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO approvals (id, tool, kind, entity_id, summary, permission, requested_by, status, decided_by, created_at)
           VALUES ('apr_x', 'widgets', 'widget', 'w_x', 's', 'widgets:approve', 'u_ana', 'approved', 'u_ana', '2025-01-01')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(getApproval(approval.id)?.status).toBe("pending");
  });

  it("a user without the permission cannot decide", async () => {
    const approval = await pendingFrom(ana);
    await expect(decideApproval(eve, approval.id, "approve", "Trying")).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(listAudit()[0]).toMatchObject({ actor_id: "u_eve", outcome: "denied" });
    expect(getApproval(approval.id)?.status).toBe("pending");
  });

  it("a decision needs a reason and a pending approval", async () => {
    const approval = await pendingFrom(ana);
    await expect(decideApproval(ben, approval.id, "approve", "   ")).rejects.toBeInstanceOf(InvalidInputError);
    await decideApproval(ben, approval.id, "approve", "ok");
    await expect(decideApproval(ben, approval.id, "reject", "changed my mind")).rejects.toBeInstanceOf(InvalidStateError);
    expect(getApproval(approval.id)?.status).toBe("approved");
  });
});

describe("payments", () => {
  it("refund() records a refund inside an action and refuses over-refunds", async () => {
    const before = getCharge("ch_1003")!;
    const refundId = await refundCharge(ben, { chargeId: "ch_1003", amountCents: 1000 });
    expect(refundId).toMatch(/^re_/);
    expect(getCharge("ch_1003")!.refunded_cents).toBe(before.refunded_cents + 1000);

    await expect(refundCharge(ben, { chargeId: "ch_1003", amountCents: before.amount_cents })).rejects.toBeInstanceOf(InvalidStateError);
    expect(getCharge("ch_1003")!.refunded_cents).toBe(before.refunded_cents + 1000);
    expect(listAudit()[0].outcome).toBe("failed");
  });

  it("refund() refuses to run outside a handler", () => {
    expect(() => refund("ch_1003", 100)).toThrow(InvalidStateError);
  });
});
