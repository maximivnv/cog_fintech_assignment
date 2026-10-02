import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  Card,
  DescriptionList,
  MaskedValue,
  PageHeader,
  ReasonForm,
  StatusBadge,
  Table,
  buttonClass,
  can,
  canDecide,
  findUser,
  listAudit,
  requireUser,
  type AuditRow,
} from "@/platform";
import { HIGH_RISK_SCORE, manifest } from "@/tools/kyc/manifest";
import { getCaseDetail } from "@/tools/kyc/queries";
import { claimKycCase, decideKycApproval, decideKycCase, revealKycPii } from "../actions";

const name = (id: string | null) => (id ? findUser(id)?.name ?? id : "—");
const when = (ts: string | null) => (ts ? new Date(ts).toLocaleString("en-US", { timeZone: "UTC" }) : "—");

export default async function KycCasePage({ params, searchParams }: PageProps<"/tools/kyc/[id]">) {
  const user = await requireUser();
  if (!can(user, "kyc:view")) {
    return <Alert tone="error">You don&apos;t have access to KYC review.</Alert>;
  }
  const { id } = await params;
  const { error } = await searchParams;
  const detail = getCaseDetail(id, user);
  if (!detail) notFound();
  const { kycCase: c, approval } = detail;
  const trail = listAudit({ tool: "kyc", entityId: c.id });
  const isAssignee = c.assignee_id === user.id;
  const canDecideCase = can(user, "kyc:decide");
  const canReveal = can(user, "kyc:reveal_pii") && !c.pii_revealed;
  const leadCanDecide = approval ? canDecide(user, approval) : false;

  return (
    <>
      <PageHeader
        title={`Case ${c.id}`}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={c.status} />
            {c.high_risk ? <StatusBadge status="high risk" tone="danger" /> : <StatusBadge status="standard risk" tone="neutral" />}
          </span>
        }
        actions={
          <Link href="/tools/kyc" className={buttonClass.secondary}>
            Queue
          </Link>
        }
      />
      {typeof error === "string" && error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Applicant">
          <DescriptionList
            items={[
              ["Name", c.applicant_name],
              ["Country", <span key="cc" className="font-mono">{c.country}</span>],
              ["Date of birth", <MaskedValue key="dob" value={c.date_of_birth} revealed={c.pii_revealed} />],
              ["Document number", <MaskedValue key="doc" value={c.document_number} revealed={c.pii_revealed} />],
              ["Risk score", `${c.risk_score} / 100${c.risk_score >= HIGH_RISK_SCORE ? " (high)" : ""}`],
              ["Watchlist", c.watchlist_hit ? "Hit" : "Clear"],
              ["Created", when(c.created_at)],
            ]}
          />
          {c.pii_revealed ? (
            <p className="mt-3 text-xs text-slate-500">
              PII revealed to you for {manifest.thresholds.revealWindowMinutes} minutes. The reveal is in the audit trail below.
            </p>
          ) : null}
          {canReveal ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-slate-700 underline-offset-2 hover:underline">
                Reveal date of birth and document number
              </summary>
              <div className="mt-2 max-w-sm">
                <ReasonForm action={revealKycPii} submitLabel="Reveal PII" tone="secondary" fields={{ caseId: c.id }} placeholder="Why do you need to see this?" />
              </div>
            </details>
          ) : null}
        </Card>
        <Card title="Review">
          <DescriptionList
            items={[
              ["Assignee", name(c.assignee_id)],
              ["Claimed", when(c.claimed_at)],
              ["Analyst recommendation", c.recommendation_reason ? `Approve: ${c.recommendation_reason}` : "—"],
              ["Decided by", name(c.decided_by)],
              ["Decided", when(c.decided_at)],
              ["Decision reason", c.decision_reason ?? "—"],
            ]}
          />
          <div className="mt-4 border-t border-slate-100 pt-4">
            {c.status === "open" ? (
              canDecideCase ? (
                <form action={claimKycCase}>
                  <input type="hidden" name="caseId" value={c.id} />
                  <button type="submit" className={buttonClass.primary}>
                    Claim this case
                  </button>
                </form>
              ) : (
                <Alert tone="info">Unclaimed. A KYC analyst has to claim it before deciding.</Alert>
              )
            ) : null}
            {c.status === "claimed" ? (
              isAssignee ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReasonForm
                    action={decideKycCase}
                    submitLabel={c.high_risk ? "Recommend approval" : "Approve"}
                    fields={{ caseId: c.id, decision: "approve" }}
                    placeholder={c.high_risk ? "Why approve? A KYC lead will review." : "Why approve?"}
                  />
                  <ReasonForm action={decideKycCase} submitLabel="Reject" tone="danger" fields={{ caseId: c.id, decision: "reject" }} placeholder="Why reject?" />
                </div>
              ) : (
                <Alert tone="info">Assigned to {name(c.assignee_id)}. Only the assignee can decide it.</Alert>
              )
            ) : null}
            {c.status === "pending_lead_review" && approval ? (
              leadCanDecide ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReasonForm
                    action={decideKycApproval}
                    submitLabel="Approve case"
                    fields={{ caseId: c.id, approvalId: approval.id, decision: "approve" }}
                    placeholder="Why sign off?"
                  />
                  <ReasonForm
                    action={decideKycApproval}
                    submitLabel="Reject case"
                    tone="danger"
                    fields={{ caseId: c.id, approvalId: approval.id, decision: "reject" }}
                    placeholder="Why reject?"
                  />
                </div>
              ) : (
                <Alert tone={approval.requested_by === user.id ? "warning" : "info"}>
                  {approval.requested_by === user.id
                    ? "You recommended this approval, so another KYC lead has to sign it off."
                    : "Waiting for a KYC lead to sign off the recommendation."}
                </Alert>
              )
            ) : null}
            {c.status === "approved" || c.status === "rejected" ? (
              <p className="text-sm text-slate-600">
                Final. {approval ? `Lead decision: ${approval.status} by ${name(approval.decided_by)}.` : "Decided by the assignee."}
              </p>
            ) : null}
          </div>
        </Card>
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Audit trail</h2>
      <Table<AuditRow>
        rows={trail}
        rowKey={(a) => a.id}
        empty="No audit rows yet."
        columns={[
          { header: "When", cell: (a) => when(a.ts) },
          { header: "Who", cell: (a) => name(a.actor_id) },
          { header: "Action", cell: (a) => <span className="font-mono">{a.action}</span> },
          { header: "Outcome", cell: (a) => <StatusBadge status={a.outcome} /> },
          {
            header: "Detail",
            cell: (a) => <code className="block max-w-xl truncate text-xs text-slate-600" title={a.detail_json}>{a.detail_json}</code>,
          },
        ]}
      />
    </>
  );
}
