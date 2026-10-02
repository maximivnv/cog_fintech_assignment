import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidInputError,
  InvalidStateError,
  NotFoundError,
  PermissionDeniedError,
  SeparationOfDutiesError,
  closeDb,
  decideApproval,
  findUser,
  getApproval,
  listAudit,
  registerTool,
} from "@/platform";
import { kyc } from "./index";
import { claimCase, decideCase, revealPii } from "./actions";
import { getCase, getCaseDetail, getCaseRow, hasRecentReveal, listCases } from "./queries";

registerTool(kyc);

const cara = findUser("u_cara")!; // kyc_analyst
const dev = findUser("u_dev")!; // kyc_analyst + kyc_lead
const eve = findUser("u_eve")!; // auditor
const ana = findUser("u_ana")!; // support_agent

// Seeded open cases: standard risk, high score, watchlist hit with a low score.
const STANDARD = "kyc_seed_01"; // score 12
const HIGH_SCORE = "kyc_seed_06"; // score 83
const WATCHLIST = "kyc_seed_07"; // score 35, watchlist hit
const CLAIMED_BY_CARA = "kyc_seed_09";
const PENDING_LEAD = "kyc_seed_11"; // Cara recommended approval

beforeEach(() => {
  closeDb();
});

async function claimed(by = cara, caseId = STANDARD) {
  await expect(claimCase(by, { caseId })).resolves.toEqual({ id: caseId, status: "claimed" });
  return getCaseRow(caseId)!;
}

describe("seed", () => {
  it("has about a dozen mixed-risk cases in every status", () => {
    const all = listCases();
    expect(all.length).toBeGreaterThanOrEqual(12);
    const byStatus = (s: string) => all.filter((c) => c.status === s);
    expect(byStatus("open").length).toBeGreaterThanOrEqual(6);
    expect(byStatus("claimed").length).toBeGreaterThanOrEqual(2);
    expect(byStatus("pending_lead_review")).toHaveLength(1);
    expect(byStatus("approved")).toHaveLength(1);
    expect(byStatus("rejected")).toHaveLength(1);
    expect(all.some((c) => c.high_risk)).toBe(true);
    expect(all.some((c) => !c.high_risk)).toBe(true);
    const pending = byStatus("pending_lead_review")[0];
    expect(getApproval(pending.approval_id!)).toMatchObject({ status: "pending", permission: "kyc:approve_high_risk", requested_by: pending.assignee_id });
  });

  it("sorts the queue by risk, highest first, with high-risk cases on top", () => {
    const all = listCases();
    const firstStandard = all.findIndex((c) => !c.high_risk);
    expect(all.slice(0, firstStandard).every((c) => c.high_risk)).toBe(true);
    expect(all.slice(firstStandard).every((c) => !c.high_risk)).toBe(true);
    for (const group of [all.slice(0, firstStandard), all.slice(firstStandard)]) {
      for (let i = 1; i < group.length; i++) expect(group[i - 1].risk_score).toBeGreaterThanOrEqual(group[i].risk_score);
    }
  });
});

describe("claim", () => {
  it("open → claimed, assigned to the claimer, audited", async () => {
    const c = await claimed(cara);
    expect(c).toMatchObject({ status: "claimed", assignee_id: cara.id });
    expect(c.claimed_at).not.toBeNull();
    const trail = listAudit({ tool: "kyc", entityId: c.id });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ action: "claim", actor_id: cara.id, outcome: "ok" });
  });

  it("cannot claim a case that is not open", async () => {
    await expect(claimCase(dev, { caseId: CLAIMED_BY_CARA })).rejects.toThrow(InvalidStateError);
    expect(getCaseRow(CLAIMED_BY_CARA)!.assignee_id).toBe(cara.id);
    await expect(claimCase(dev, { caseId: PENDING_LEAD })).rejects.toThrow(InvalidStateError);
    await expect(claimCase(dev, { caseId: "kyc_seed_12" })).rejects.toThrow(/approved/);
    await expect(claimCase(dev, { caseId: "kyc_seed_13" })).rejects.toThrow(/rejected/);
    expect(listAudit({ tool: "kyc", actorId: dev.id })[0].outcome).toBe("failed");
  });

  it("cannot claim twice, even by the same analyst", async () => {
    await claimed(cara);
    await expect(claimCase(cara, { caseId: STANDARD })).rejects.toThrow(InvalidStateError);
  });

  it("unknown case", async () => {
    await expect(claimCase(cara, { caseId: "kyc_nope" })).rejects.toThrow(NotFoundError);
  });
});

describe("decide: standard risk", () => {
  it("claimed → approved by the assignee, no approval needed", async () => {
    await claimed(cara);
    await expect(decideCase(cara, { caseId: STANDARD, decision: "approve", reason: "Docs check out" })).resolves.toEqual({ id: STANDARD, status: "approved" });
    const c = getCaseRow(STANDARD)!;
    expect(c).toMatchObject({ status: "approved", decided_by: cara.id, decision_reason: "Docs check out", approval_id: null });
    expect(c.decided_at).not.toBeNull();
    expect(listAudit({ tool: "kyc", entityId: STANDARD }).map((a) => a.action)).toEqual(["decide", "claim"]);
  });

  it("claimed → rejected by the assignee", async () => {
    await claimed(cara);
    await expect(decideCase(cara, { caseId: STANDARD, decision: "reject", reason: "Document expired" })).resolves.toEqual({ id: STANDARD, status: "rejected" });
    expect(getCaseRow(STANDARD)).toMatchObject({ status: "rejected", decided_by: cara.id });
  });

  it("only the assignee decides, even for a lead", async () => {
    await claimed(cara);
    await expect(decideCase(dev, { caseId: STANDARD, decision: "approve", reason: "Mine now" })).rejects.toThrow(PermissionDeniedError);
    expect(getCaseRow(STANDARD)!.status).toBe("claimed");
    const last = listAudit({ tool: "kyc", entityId: STANDARD })[0];
    expect(last).toMatchObject({ actor_id: dev.id, action: "decide", outcome: "failed" });
  });

  it("cannot decide an open, pending or final case", async () => {
    await expect(decideCase(cara, { caseId: STANDARD, decision: "approve", reason: "Not claimed" })).rejects.toThrow(InvalidStateError);
    await expect(decideCase(cara, { caseId: PENDING_LEAD, decision: "reject", reason: "Changed my mind" })).rejects.toThrow(InvalidStateError);
    await expect(decideCase(cara, { caseId: "kyc_seed_12", decision: "reject", reason: "Undo" })).rejects.toThrow(InvalidStateError);
    await claimed(cara);
    await decideCase(cara, { caseId: STANDARD, decision: "reject", reason: "No" });
    await expect(decideCase(cara, { caseId: STANDARD, decision: "approve", reason: "Yes after all" })).rejects.toThrow(InvalidStateError);
    expect(getCaseRow(STANDARD)!.status).toBe("rejected");
  });

  it("needs a reason and a valid decision", async () => {
    await claimed(cara);
    await expect(decideCase(cara, { caseId: STANDARD, decision: "approve", reason: "  " })).rejects.toThrow(InvalidInputError);
    await expect(decideCase(cara, { caseId: STANDARD, decision: "maybe", reason: "x" })).rejects.toThrow(InvalidInputError);
    expect(getCaseRow(STANDARD)!.status).toBe("claimed");
  });
});

describe("decide: high risk", () => {
  it.each([
    ["score ≥ 70", HIGH_SCORE],
    ["watchlist hit with a low score", WATCHLIST],
  ])("approving a case with %s only records a recommendation and asks a lead", async (_label, caseId) => {
    await claimed(cara, caseId);
    await expect(decideCase(cara, { caseId, decision: "approve", reason: "Explained" })).resolves.toEqual({ id: caseId, status: "pending_lead_review" });
    const c = getCaseRow(caseId)!;
    expect(c).toMatchObject({ status: "pending_lead_review", recommendation_reason: "Explained", decided_by: null });
    expect(getApproval(c.approval_id!)).toMatchObject({
      status: "pending",
      kind: "high_risk_approval",
      permission: "kyc:approve_high_risk",
      requested_by: cara.id,
      entity_id: caseId,
    });
  });

  it("rejecting a high-risk case is final without a lead", async () => {
    await claimed(cara, HIGH_SCORE);
    await expect(decideCase(cara, { caseId: HIGH_SCORE, decision: "reject", reason: "Fails screening" })).resolves.toEqual({ id: HIGH_SCORE, status: "rejected" });
    expect(getCaseRow(HIGH_SCORE)).toMatchObject({ status: "rejected", decided_by: cara.id, approval_id: null });
  });

  it("a lead approves Cara's recommendation → approved", async () => {
    const c = getCaseRow(PENDING_LEAD)!;
    await decideApproval(dev, c.approval_id!, "approve", "Agree with the analyst");
    expect(getCaseRow(PENDING_LEAD)).toMatchObject({ status: "approved", decided_by: dev.id, decision_reason: "Agree with the analyst" });
    expect(getApproval(c.approval_id!)).toMatchObject({ status: "approved", decided_by: dev.id });
    expect(listAudit({ tool: "kyc", entityId: PENDING_LEAD })[0]).toMatchObject({ action: "approval.approve", actor_id: dev.id, outcome: "ok" });
  });

  it("a lead rejects the recommendation → rejected", async () => {
    const c = getCaseRow(PENDING_LEAD)!;
    await decideApproval(dev, c.approval_id!, "reject", "Adverse media is a real match");
    expect(getCaseRow(PENDING_LEAD)).toMatchObject({ status: "rejected", decided_by: dev.id });
  });

  it("an analyst cannot sign off: no kyc:approve_high_risk", async () => {
    const c = getCaseRow(PENDING_LEAD)!;
    await expect(decideApproval(cara, c.approval_id!, "approve", "Me")).rejects.toThrow(PermissionDeniedError);
    expect(getCaseRow(PENDING_LEAD)!.status).toBe("pending_lead_review");
  });

  it("Dev cannot sign off his own recommendation even though he is a lead", async () => {
    await claimed(dev, HIGH_SCORE);
    await decideCase(dev, { caseId: HIGH_SCORE, decision: "approve", reason: "Looks fine to me" });
    const c = getCaseRow(HIGH_SCORE)!;
    expect(c.status).toBe("pending_lead_review");
    await expect(decideApproval(dev, c.approval_id!, "approve", "Approving myself")).rejects.toThrow(SeparationOfDutiesError);
    expect(getCaseRow(HIGH_SCORE)!.status).toBe("pending_lead_review");
    expect(listAudit({ tool: "kyc", entityId: HIGH_SCORE })[0]).toMatchObject({ actor_id: dev.id, action: "approval.approve", outcome: "denied" });
  });

  it("Dev can sign off a case he did not recommend", async () => {
    await claimed(cara, WATCHLIST);
    await decideCase(cara, { caseId: WATCHLIST, decision: "approve", reason: "False positive" });
    await decideApproval(dev, getCaseRow(WATCHLIST)!.approval_id!, "approve", "Confirmed false positive");
    expect(getCaseRow(WATCHLIST)!.status).toBe("approved");
  });

  it("a settled approval cannot be decided again", async () => {
    const c = getCaseRow(PENDING_LEAD)!;
    await decideApproval(dev, c.approval_id!, "reject", "No");
    await expect(decideApproval(dev, c.approval_id!, "approve", "Changed my mind")).rejects.toThrow(InvalidStateError);
    expect(getCaseRow(PENDING_LEAD)!.status).toBe("rejected");
  });
});

describe("PII", () => {
  it("is masked in the queue and on the detail page by default", () => {
    const raw = getCaseRow(STANDARD)!;
    for (const c of [getCase(STANDARD)!, listCases().find((x) => x.id === STANDARD)!, getCaseDetail(STANDARD, cara)!.kycCase]) {
      expect(c.pii_revealed).toBe(false);
      expect(c.date_of_birth).not.toBe(raw.date_of_birth);
      expect(c.document_number).not.toBe(raw.document_number);
      expect(c.date_of_birth).toMatch(/^\*/);
      expect(c.document_number).toMatch(/^\*/);
      expect(c.applicant_name).toBe(raw.applicant_name);
    }
  });

  it("reveal returns the values, is audited with a reason and unmasks the detail for the revealer only", async () => {
    const raw = getCaseRow(STANDARD)!;
    const out = await revealPii(cara, { caseId: STANDARD, reason: "Verifying against the uploaded passport" });
    expect(out).toEqual({ id: STANDARD, date_of_birth: raw.date_of_birth, document_number: raw.document_number });
    const row = listAudit({ tool: "kyc", entityId: STANDARD })[0];
    expect(row).toMatchObject({ action: "reveal_pii", actor_id: cara.id, outcome: "ok" });
    expect(JSON.parse(row.detail_json)).toMatchObject({
      input: { caseId: STANDARD, reason: "Verifying against the uploaded passport" },
      fields: ["date_of_birth", "document_number"],
    });
    expect(hasRecentReveal(cara, STANDARD)).toBe(true);
    expect(getCaseDetail(STANDARD, cara)!.kycCase).toMatchObject({ pii_revealed: true, date_of_birth: raw.date_of_birth, document_number: raw.document_number });
    expect(getCaseDetail(STANDARD, dev)!.kycCase.pii_revealed).toBe(false);
    expect(getCaseDetail("kyc_seed_02", cara)!.kycCase.pii_revealed).toBe(false);
    expect(listCases().find((c) => c.id === STANDARD)!.pii_revealed).toBe(false);
  });

  it("the reveal expires", async () => {
    await revealPii(cara, { caseId: STANDARD, reason: "Check" });
    expect(hasRecentReveal(cara, STANDARD, new Date(Date.now() + 14 * 60_000))).toBe(true);
    expect(hasRecentReveal(cara, STANDARD, new Date(Date.now() + 16 * 60_000))).toBe(false);
  });

  it("needs kyc:reveal_pii and a reason; denials are audited", async () => {
    for (const user of [eve, ana]) {
      await expect(revealPii(user, { caseId: STANDARD, reason: "Curious" })).rejects.toThrow(PermissionDeniedError);
      expect(listAudit({ tool: "kyc", actorId: user.id })[0]).toMatchObject({ action: "reveal_pii", outcome: "denied" });
    }
    await expect(revealPii(cara, { caseId: STANDARD, reason: " " })).rejects.toThrow(InvalidInputError);
    expect(hasRecentReveal(cara, STANDARD)).toBe(false);
    expect(hasRecentReveal(eve, STANDARD)).toBe(false);
  });
});

describe("permissions", () => {
  it("auditors and support agents cannot claim or decide, and the denial is audited", async () => {
    for (const user of [eve, ana]) {
      await expect(claimCase(user, { caseId: STANDARD })).rejects.toThrow(PermissionDeniedError);
      await expect(decideCase(user, { caseId: CLAIMED_BY_CARA, decision: "approve", reason: "x" })).rejects.toThrow(PermissionDeniedError);
      expect(listAudit({ tool: "kyc", actorId: user.id }).map((a) => a.outcome)).toEqual(["denied", "denied"]);
    }
    expect(getCaseRow(STANDARD)!.status).toBe("open");
    expect(getCaseRow(CLAIMED_BY_CARA)!.status).toBe("claimed");
  });
});
