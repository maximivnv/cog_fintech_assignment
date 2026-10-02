import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidInputError,
  InvalidStateError,
  PermissionDeniedError,
  SeparationOfDutiesError,
  closeDb,
  decideApproval,
  findUser,
  getApproval,
  getCharge,
  listAudit,
  listRefundsForCharge,
  registerTool,
  type Decision,
} from "@/platform";
import { refunds } from "./index";
import { requestRefund } from "./actions";
import { getRefund, listRefunds, remainingCents } from "./queries";

registerTool(refunds);

const ana = findUser("u_ana")!; // support_agent
const ben = findUser("u_ben")!; // finance_approver
const rio = findUser("u_rio")!; // support_agent + finance_approver
const eve = findUser("u_eve")!; // auditor

beforeEach(() => {
  closeDb();
});

async function pendingRequest(by = ana, chargeId = "ch_1004", amountCents = 25_000) {
  const { id, status } = await requestRefund(by, { chargeId, amountCents, reason: "test" });
  expect(status).toBe("pending_approval");
  return getRefund(id)!;
}

describe("seed", () => {
  it("has a few pending, one executed and one rejected refund", () => {
    const all = listRefunds();
    expect(all.filter((r) => r.status === "pending_approval").length).toBeGreaterThanOrEqual(2);
    expect(all.filter((r) => r.status === "executed")).toHaveLength(1);
    expect(all.filter((r) => r.status === "rejected")).toHaveLength(1);
    const executed = all.find((r) => r.status === "executed")!;
    expect(getCharge(executed.charge_id)!.refunded_cents).toBe(executed.amount_cents);
    for (const r of all.filter((r) => r.status !== "executed")) {
      expect(getApproval(r.approval_id!)?.status).toBe(r.status === "rejected" ? "rejected" : "pending");
    }
  });
});

describe("tier routing", () => {
  it("executes up to $100 immediately", async () => {
    const { id, status } = await requestRefund(ana, { chargeId: "ch_1004", amountCents: 10_000, reason: "Goodwill" });
    expect(status).toBe("executed");
    const r = getRefund(id)!;
    expect(r.payment_refund_id).not.toBeNull();
    expect(r.approval_id).toBeNull();
    expect(getCharge("ch_1004")!.refunded_cents).toBe(10_000);
    const audit = listAudit({ tool: "refunds", entityId: id });
    expect(audit).toHaveLength(1);
    expect(audit[0].outcome).toBe("ok");
  });

  it("needs approval from $100.01 to $5,000", async () => {
    for (const amountCents of [10_001, 500_000]) {
      const { id, status } = await requestRefund(ana, { chargeId: "ch_1004", amountCents, reason: "Big" });
      expect(status).toBe("pending_approval");
      const r = getRefund(id)!;
      expect(r.payment_refund_id).toBeNull();
      const approval = getApproval(r.approval_id!)!;
      expect(approval).toMatchObject({ status: "pending", permission: "refunds:approve", requested_by: ana.id, entity_id: id });
    }
    expect(getCharge("ch_1004")!.refunded_cents).toBe(0);
  });

  it("refuses over $5,000 and asks to escalate to finance", async () => {
    await expect(requestRefund(ana, { chargeId: "ch_1004", amountCents: 500_001, reason: "Huge" })).rejects.toThrow(
      /escalate to finance/,
    );
    expect(listRefunds().filter((r) => r.charge_id === "ch_1004")).toHaveLength(0);
    expect(listAudit({ tool: "refunds", actorId: ana.id })[0].outcome).toBe("failed");
  });
});

describe("over-refund", () => {
  it("refuses more than what is left on the charge", async () => {
    // ch_1003 is $49.00
    await expect(requestRefund(ana, { chargeId: "ch_1003", amountCents: 4_901, reason: "Too much" })).rejects.toThrow(InvalidStateError);
    await expect(requestRefund(ana, { chargeId: "ch_1003", amountCents: 4_900, reason: "All of it" })).resolves.toMatchObject({ status: "executed" });
    await expect(requestRefund(ana, { chargeId: "ch_1003", amountCents: 1, reason: "One more" })).rejects.toThrow(/exceeds/);
  });

  it("counts pending requests against the charge", async () => {
    // ch_1008 is $2,400.00
    await pendingRequest(ana, "ch_1008", 200_000);
    expect(remainingCents(getCharge("ch_1008")!)).toBe(40_000);
    await expect(requestRefund(ana, { chargeId: "ch_1008", amountCents: 40_001, reason: "Over" })).rejects.toThrow(/pending/);
    await expect(requestRefund(ana, { chargeId: "ch_1008", amountCents: 40_000, reason: "Exact" })).resolves.toMatchObject({
      status: "pending_approval",
    });
  });

  it("re-checks the charge when an approval executes", async () => {
    const a = await pendingRequest(ana, "ch_1008", 200_000);
    const b = await pendingRequest(ana, "ch_1008", 40_000);
    // Rejecting b frees its share; approving a still has to fit what the processor has left.
    await decideApproval(ben, b.approval_id!, "reject", "Not this one");
    await decideApproval(ben, a.approval_id!, "approve", "Fine");
    expect(getCharge("ch_1008")!.refunded_cents).toBe(200_000);
    expect(getRefund(b.id)!.status).toBe("rejected");
    expect(getRefund(a.id)!.status).toBe("executed");
  });
});

describe("approvals", () => {
  it("Ben approves Ana's request and it executes", async () => {
    const r = await pendingRequest(ana);
    await decideApproval(ben, r.approval_id!, "approve", "Looks right");
    const after = getRefund(r.id)!;
    expect(after.status).toBe("executed");
    expect(after.payment_refund_id).not.toBeNull();
    expect(after.decided_at).not.toBeNull();
    expect(getCharge("ch_1004")!.refunded_cents).toBe(25_000);
    expect(listRefundsForCharge("ch_1004").map((p) => p.id)).toContain(after.payment_refund_id);
    const approval = getApproval(r.approval_id!)!;
    expect(approval).toMatchObject({ status: "approved", decided_by: ben.id, reason: "Looks right" });
    const trail = listAudit({ tool: "refunds", entityId: r.id });
    expect(trail.map((a) => a.action)).toEqual(["approval.approve", "request"]);
  });

  it("Ben rejects and nothing is refunded", async () => {
    const r = await pendingRequest(ana);
    await decideApproval(ben, r.approval_id!, "reject", "Outside policy");
    expect(getRefund(r.id)!.status).toBe("rejected");
    expect(getRefund(r.id)!.payment_refund_id).toBeNull();
    expect(getCharge("ch_1004")!.refunded_cents).toBe(0);
  });

  it("Ana cannot approve: no refunds:approve", async () => {
    const r = await pendingRequest(ana);
    await expect(decideApproval(ana, r.approval_id!, "approve", "Me")).rejects.toThrow(PermissionDeniedError);
    expect(getRefund(r.id)!.status).toBe("pending_approval");
  });

  it("Rio cannot approve his own request even though he is a finance approver", async () => {
    const r = await pendingRequest(rio);
    await expect(decideApproval(rio, r.approval_id!, "approve", "Approving myself")).rejects.toThrow(SeparationOfDutiesError);
    expect(getRefund(r.id)!.status).toBe("pending_approval");
    expect(getCharge("ch_1004")!.refunded_cents).toBe(0);
    const denied = listAudit({ tool: "refunds", entityId: r.id })[0];
    expect(denied.outcome).toBe("denied");
    expect(denied.actor_id).toBe(rio.id);
    // Someone else can.
    await decideApproval(ben, r.approval_id!, "approve", "Checked");
    expect(getRefund(r.id)!.status).toBe("executed");
  });

  it("Rio can approve Ana's request", async () => {
    const r = await pendingRequest(ana);
    await decideApproval(rio, r.approval_id!, "approve", "ok");
    expect(getRefund(r.id)!.status).toBe("executed");
  });

  it("a decided refund cannot be decided again", async () => {
    const r = await pendingRequest(ana);
    await decideApproval(ben, r.approval_id!, "reject", "No");
    await expect(decideApproval(ben, r.approval_id!, "approve", "Changed my mind")).rejects.toThrow(InvalidStateError);
    expect(getRefund(r.id)!.status).toBe("rejected");
  });

  it("a decision that is not approve or reject is refused, not coerced", async () => {
    const r = await pendingRequest(ana);
    await expect(decideApproval(ben, r.approval_id!, "maybe" as Decision, "Typo")).rejects.toThrow(InvalidInputError);
    expect(getApproval(r.approval_id!)!.status).toBe("pending");
    expect(getRefund(r.id)!.status).toBe("pending_approval");
  });
});

describe("permissions and input", () => {
  it("refuses a requester without refunds:request and audits it", async () => {
    for (const user of [ben, eve]) {
      await expect(requestRefund(user, { chargeId: "ch_1004", amountCents: 100, reason: "x" })).rejects.toThrow(PermissionDeniedError);
      expect(listAudit({ tool: "refunds", actorId: user.id })[0].outcome).toBe("denied");
    }
    expect(listRefunds().filter((r) => r.charge_id === "ch_1004")).toHaveLength(0);
  });

  it("rejects bad input", async () => {
    await expect(requestRefund(ana, { chargeId: "ch_1004", amountCents: -5, reason: "x" })).rejects.toThrow(InvalidInputError);
    await expect(requestRefund(ana, { chargeId: "ch_1004", amountCents: 12.5, reason: "x" })).rejects.toThrow(InvalidInputError);
    await expect(requestRefund(ana, { chargeId: "ch_1004", amountCents: 100, reason: "  " })).rejects.toThrow(InvalidInputError);
    await expect(requestRefund(ana, { chargeId: "ch_nope", amountCents: 100, reason: "x" })).rejects.toThrow(/not found/);
    expect(listRefunds().filter((r) => r.charge_id === "ch_1004")).toHaveLength(0);
  });
});
