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
  listApprovals,
  listAudit,
  registerTool,
} from "@/platform";
import { disputes } from "./index";
import { acceptLoss, addNote, recordOutcome, submitResponse } from "./actions";
import { ACCEPT_LOSS_APPROVAL_CENTS } from "./manifest";
import { daysLeft, getDispute, listDisputes, listNotes, type Dispute } from "./queries";

registerTool(disputes);

const ana = findUser("u_ana")!; // support_agent (disputes analyst)
const ben = findUser("u_ben")!; // finance_approver
const rio = findUser("u_rio")!; // support_agent + finance_approver
const eve = findUser("u_eve")!; // auditor

// Seed rows with no pending approval: dp_seed_1 is $7,500 (over the threshold), dp_seed_2 is $459.99 (under).
const BIG = "dp_seed_1";
const SMALL = "dp_seed_2";
const NO_NOTES = "dp_seed_2";
const PENDING_FINANCE = "dp_seed_4";
const SUBMITTED = "dp_seed_5";

beforeEach(() => {
  closeDb();
});

async function pendingAccept(by = ana, id = BIG) {
  const { status } = await acceptLoss(by, { disputeId: id, reason: "Not worth contesting" });
  expect(status).toBe("needs_response");
  const d = getDispute(id)!;
  expect(d.approval_id).not.toBeNull();
  return d;
}

describe("seed", () => {
  it("covers every status, one pending loss acceptance, and sorts by deadline", () => {
    const all = listDisputes();
    for (const s of ["needs_response", "submitted", "accepted", "won", "lost"]) {
      expect(all.some((d) => d.status === s), s).toBe(true);
    }
    const deadlines = all.map((d) => d.response_deadline);
    expect(deadlines).toEqual([...deadlines].sort());
    const pending = all.filter((d) => d.approval_id);
    expect(pending.map((d) => d.id)).toEqual([PENDING_FINANCE]);
    expect(getApproval(pending[0].approval_id!)).toMatchObject({ status: "pending", permission: "disputes:approve_loss", entity_id: PENDING_FINANCE });
    expect(listDisputes({ status: "won" }).every((d) => d.status === "won")).toBe(true);
    expect(getDispute(BIG)!.amount_cents).toBeGreaterThan(ACCEPT_LOSS_APPROVAL_CENTS);
    expect(getDispute(SMALL)!.amount_cents).toBeLessThanOrEqual(ACCEPT_LOSS_APPROVAL_CENTS);
    expect(listNotes(NO_NOTES)).toHaveLength(0);
  });
});

describe("days left", () => {
  const today = new Date("2025-03-10T15:00:00Z");
  it("counts whole days to the deadline, negative when overdue", () => {
    expect(daysLeft("2025-03-10", today)).toBe(0);
    expect(daysLeft("2025-03-13", today)).toBe(3);
    expect(daysLeft("2025-03-08", today)).toBe(-2);
    expect(daysLeft("2025-04-01", today)).toBe(22);
  });
});

describe("evidence notes", () => {
  it("an analyst adds a note to an open dispute and it is audited", async () => {
    for (const id of [SMALL, SUBMITTED]) {
      const { id: noteId } = await addNote(ana, { disputeId: id, body: "Signed delivery confirmation attached" });
      const notes = listNotes(id);
      expect(notes.at(-1)).toMatchObject({ id: noteId, author_id: ana.id, body: "Signed delivery confirmation attached" });
      const audit = listAudit({ tool: "disputes", entityId: id });
      expect(audit[0]).toMatchObject({ action: "add_note", outcome: "ok", actor_id: ana.id });
    }
  });

  it("refuses notes on closed disputes", async () => {
    for (const status of ["accepted", "won", "lost"] as const) {
      const d = listDisputes({ status })[0];
      await expect(addNote(ana, { disputeId: d.id, body: "Too late" })).rejects.toThrow(InvalidStateError);
      expect(listNotes(d.id).filter((n) => n.body === "Too late")).toHaveLength(0);
    }
  });

  it("rejects an empty note", async () => {
    await expect(addNote(ana, { disputeId: SMALL, body: "   " })).rejects.toThrow(InvalidInputError);
  });
});

describe("submit response", () => {
  it("needs_response -> submitted once there is evidence", async () => {
    await addNote(ana, { disputeId: NO_NOTES, body: "Tracking shows delivered and signed" });
    const { status } = await submitResponse(ana, { disputeId: NO_NOTES });
    expect(status).toBe("submitted");
    const d = getDispute(NO_NOTES)!;
    expect(d.status).toBe("submitted");
    expect(d.submitted_at).not.toBeNull();
    expect(listAudit({ tool: "disputes", entityId: NO_NOTES }).map((a) => a.action)).toEqual(["submit_response", "add_note"]);
  });

  it("refuses to submit without evidence notes", async () => {
    await expect(submitResponse(ana, { disputeId: NO_NOTES })).rejects.toThrow(/evidence/);
    expect(getDispute(NO_NOTES)!.status).toBe("needs_response");
    expect(listAudit({ tool: "disputes", entityId: NO_NOTES })[0].outcome).toBe("failed");
  });

  it("refuses to submit while a loss acceptance is pending", async () => {
    await expect(submitResponse(ana, { disputeId: PENDING_FINANCE })).rejects.toThrow(/waiting on finance/);
    expect(getDispute(PENDING_FINANCE)!.status).toBe("needs_response");
  });

  it("refuses to submit from any other status", async () => {
    for (const status of ["submitted", "accepted", "won", "lost"] as const) {
      const d = listDisputes({ status })[0];
      await expect(submitResponse(ana, { disputeId: d.id })).rejects.toThrow(InvalidStateError);
      expect(getDispute(d.id)!.status).toBe(status);
    }
  });
});

describe("accept loss", () => {
  it("accepts immediately at or under $500", async () => {
    const { status } = await acceptLoss(ana, { disputeId: SMALL, reason: "Cheaper than fighting it" });
    expect(status).toBe("accepted");
    const d = getDispute(SMALL)!;
    expect(d).toMatchObject({ status: "accepted", approval_id: null });
    expect(d.decided_at).not.toBeNull();
    expect(listApprovals({ tool: "disputes", entityId: SMALL })).toHaveLength(0);
    expect(listAudit({ tool: "disputes", entityId: SMALL })[0]).toMatchObject({ action: "accept_loss", outcome: "ok" });
  });

  it("asks finance over $500 and stays needs_response until decided", async () => {
    const d = await pendingAccept();
    expect(d.status).toBe("needs_response");
    const approval = getApproval(d.approval_id!)!;
    expect(approval).toMatchObject({ status: "pending", permission: "disputes:approve_loss", requested_by: ana.id, entity_id: BIG, kind: "accept_loss" });
    expect(approval.summary).toContain("Not worth contesting");
  });

  it("cannot be requested twice while pending", async () => {
    await pendingAccept();
    await expect(acceptLoss(ana, { disputeId: BIG, reason: "Again" })).rejects.toThrow(/waiting on finance/);
    expect(listApprovals({ tool: "disputes", entityId: BIG })).toHaveLength(1);
  });

  it("refuses from any other status", async () => {
    for (const status of ["submitted", "accepted", "won", "lost"] as const) {
      const d = listDisputes({ status })[0];
      await expect(acceptLoss(ana, { disputeId: d.id, reason: "x" })).rejects.toThrow(InvalidStateError);
      expect(getDispute(d.id)!.status).toBe(status);
    }
  });

  it("Ben approves Ana's request and the dispute is accepted", async () => {
    const d = await pendingAccept();
    await decideApproval(ben, d.approval_id!, "approve", "Low odds of winning");
    const after = getDispute(BIG)!;
    expect(after.status).toBe("accepted");
    expect(after.decided_at).not.toBeNull();
    expect(after.approval_id).toBe(d.approval_id);
    expect(getApproval(d.approval_id!)).toMatchObject({ status: "approved", decided_by: ben.id });
    expect(listAudit({ tool: "disputes", entityId: BIG }).map((a) => a.action)).toEqual(["approval.approve", "accept_loss"]);
  });

  it("Ben rejects and the analyst can keep working the dispute", async () => {
    const d = await pendingAccept();
    await decideApproval(ben, d.approval_id!, "reject", "Fight it, we have the delivery slip");
    const after = getDispute(BIG)!;
    expect(after).toMatchObject({ status: "needs_response", approval_id: null });
    expect(getApproval(d.approval_id!)).toMatchObject({ status: "rejected", decided_by: ben.id });
    await expect(submitResponse(ana, { disputeId: BIG })).resolves.toMatchObject({ status: "submitted" });
    expect(listApprovals({ tool: "disputes", entityId: BIG })).toHaveLength(1);
  });

  it("the requester cannot decide their own request, even holding both roles", async () => {
    const d = await pendingAccept(rio);
    await expect(decideApproval(rio, d.approval_id!, "approve", "ok")).rejects.toThrow(SeparationOfDutiesError);
    expect(getDispute(BIG)!.status).toBe("needs_response");
    expect(listAudit({ tool: "disputes", entityId: BIG })[0]).toMatchObject({ action: "approval.approve", outcome: "denied", actor_id: rio.id });
    // Another finance approver can.
    await decideApproval(ben, d.approval_id!, "approve", "ok");
    expect(getDispute(BIG)!.status).toBe("accepted");
  });

  it("Rio can decide Ana's request", async () => {
    const d = await pendingAccept(ana);
    await decideApproval(rio, d.approval_id!, "approve", "ok");
    expect(getDispute(BIG)!.status).toBe("accepted");
  });

  it("an analyst without disputes:approve_loss cannot decide", async () => {
    const d = await pendingAccept(ana);
    const approval = getApproval(d.approval_id!)!;
    await expect(decideApproval(ana, approval.id, "approve", "me")).rejects.toThrow(PermissionDeniedError);
    expect(getDispute(BIG)!.status).toBe("needs_response");
  });

  it("a decided approval cannot be decided again", async () => {
    const d = await pendingAccept();
    await decideApproval(ben, d.approval_id!, "reject", "No");
    await expect(decideApproval(ben, d.approval_id!, "approve", "Changed my mind")).rejects.toThrow(InvalidStateError);
    expect(getDispute(BIG)!.status).toBe("needs_response");
  });
});

describe("record outcome", () => {
  it("submitted -> won | lost", async () => {
    for (const outcome of ["won", "lost"] as const) {
      closeDb();
      const { status } = await recordOutcome(ana, { disputeId: SUBMITTED, outcome, reason: "Network ruled" });
      expect(status).toBe(outcome);
      const d = getDispute(SUBMITTED)!;
      expect(d.status).toBe(outcome);
      expect(d.decided_at).not.toBeNull();
      expect(listAudit({ tool: "disputes", entityId: SUBMITTED })[0]).toMatchObject({ action: "record_outcome", outcome: "ok" });
    }
  });

  it("refuses from any other status", async () => {
    for (const status of ["needs_response", "accepted", "won", "lost"] as const) {
      const d = listDisputes({ status })[0];
      await expect(recordOutcome(ana, { disputeId: d.id, outcome: "won", reason: "x" })).rejects.toThrow(InvalidStateError);
      expect(getDispute(d.id)!.status).toBe(status);
    }
  });

  it("rejects an outcome that is not won or lost", async () => {
    await expect(recordOutcome(ana, { disputeId: SUBMITTED, outcome: "accepted", reason: "x" })).rejects.toThrow(InvalidInputError);
    expect(getDispute(SUBMITTED)!.status).toBe("submitted");
  });

  it("closed disputes stay closed", async () => {
    for (const status of ["accepted", "won", "lost"] as const) {
      const d: Dispute = listDisputes({ status })[0];
      await expect(submitResponse(ana, { disputeId: d.id })).rejects.toThrow(InvalidStateError);
      await expect(acceptLoss(ana, { disputeId: d.id, reason: "x" })).rejects.toThrow(InvalidStateError);
      await expect(recordOutcome(ana, { disputeId: d.id, outcome: "lost", reason: "x" })).rejects.toThrow(InvalidStateError);
      expect(getDispute(d.id)!.status).toBe(status);
    }
  });
});

describe("permissions and input", () => {
  it("refuses users without disputes:work and audits it", async () => {
    for (const user of [ben, eve]) {
      await expect(addNote(user, { disputeId: SMALL, body: "x" })).rejects.toThrow(PermissionDeniedError);
      await expect(submitResponse(user, { disputeId: SMALL })).rejects.toThrow(PermissionDeniedError);
      await expect(acceptLoss(user, { disputeId: SMALL, reason: "x" })).rejects.toThrow(PermissionDeniedError);
      await expect(recordOutcome(user, { disputeId: SUBMITTED, outcome: "won", reason: "x" })).rejects.toThrow(PermissionDeniedError);
      expect(listAudit({ tool: "disputes", actorId: user.id }).every((a) => a.outcome === "denied")).toBe(true);
    }
    expect(getDispute(SMALL)!.status).toBe("needs_response");
    expect(getDispute(SUBMITTED)!.status).toBe("submitted");
  });

  it("rejects bad input and unknown disputes", async () => {
    await expect(acceptLoss(ana, { disputeId: SMALL, reason: "  " })).rejects.toThrow(InvalidInputError);
    await expect(acceptLoss(ana, { disputeId: "dp_nope", reason: "x" })).rejects.toThrow(/not found/);
    await expect(addNote(ana, { disputeId: "dp_nope", body: "x" })).rejects.toThrow(/not found/);
    expect(getDispute(SMALL)!.status).toBe("needs_response");
  });
});
