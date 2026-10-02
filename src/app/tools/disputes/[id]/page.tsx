import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  Card,
  DescriptionList,
  Money,
  PageHeader,
  ReasonForm,
  StatusBadge,
  Table,
  buttonClass,
  can,
  canDecide,
  findUser,
  formatCents,
  listAudit,
  requireUser,
  type Approval,
  type AuditRow,
  SectionLabel,
} from "@/platform";
import { ACCEPT_LOSS_APPROVAL_CENTS } from "@/tools/disputes/manifest";
import { getDisputeDetail, isOpen } from "@/tools/disputes/queries";
import { DaysLeft } from "../days-left";
import { acceptDisputeLoss, addDisputeNote, decideDisputeLoss, recordDisputeOutcome, submitDisputeResponse } from "../actions";

const name = (id: string | null) => (id ? findUser(id)?.name ?? id : "—");
const when = (ts: string | null) => (ts ? new Date(ts).toLocaleString("en-US", { timeZone: "UTC" }) : "—");

export default async function DisputeDetailPage({ params, searchParams }: PageProps<"/tools/disputes/[id]">) {
  const user = await requireUser();
  if (!can(user, "disputes:view")) {
    return <Alert tone="error">You don&apos;t have access to Disputes.</Alert>;
  }
  const { id } = await params;
  const { error } = await searchParams;
  const detail = getDisputeDetail(id);
  if (!detail) notFound();
  const { dispute, charge, notes, approvals } = detail;
  const trail = listAudit({ tool: "disputes", entityId: dispute.id });
  const pending = approvals.find((a) => a.id === dispute.approval_id && a.status === "pending") ?? null;
  const worker = can(user, "disputes:work");
  const needsFinance = dispute.amount_cents > ACCEPT_LOSS_APPROVAL_CENTS;

  return (
    <>
      <PageHeader
        title={`Dispute ${dispute.id}`}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={dispute.status} />
            {pending ? <StatusBadge status="pending finance" /> : null}
            <DaysLeft dispute={dispute} />
          </span>
        }
        actions={
          <Link href="/tools/disputes" className={buttonClass.secondary}>
            All disputes
          </Link>
        }
      />
      {typeof error === "string" && error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Chargeback">
          <DescriptionList
            items={[
              ["Amount", <Money key="amt" cents={dispute.amount_cents} />],
              ["Customer", dispute.customer],
              ["Reason", <StatusBadge key="rsn" status={dispute.reason} tone="neutral" />],
              ["Response deadline", dispute.response_deadline],
              ["Charge", `${charge.id} · ${charge.customer} · ${charge.description}`],
              ["Charge total", <Money key="tot" cents={charge.amount_cents} />],
              ["Received", when(dispute.created_at)],
              ["Response submitted", when(dispute.submitted_at)],
              ["Closed", when(dispute.decided_at)],
            ]}
          />
        </Card>
        <Card title="Evidence notes">
          {notes.length === 0 ? <p className="text-sm text-zinc-500">No evidence yet.</p> : null}
          <ol className="flex flex-col gap-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm">
                <p className="whitespace-pre-wrap text-zinc-800">{n.body}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {name(n.author_id)} · {when(n.created_at)}
                </p>
              </li>
            ))}
          </ol>
          {worker && isOpen(dispute.status) ? (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <ReasonForm action={addDisputeNote} submitLabel="Add note" tone="secondary" fields={{ disputeId: dispute.id }} placeholder="Evidence note" />
            </div>
          ) : null}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Response">
          {dispute.status === "needs_response" ? (
            pending ? (
              <Alert tone="info">A loss acceptance is waiting on finance. Submitting is blocked until it is decided.</Alert>
            ) : worker ? (
              <div className="flex flex-col gap-4">
                <form action={submitDisputeResponse}>
                  <input type="hidden" name="disputeId" value={dispute.id} />
                  <button type="submit" className={buttonClass.primary} disabled={notes.length === 0}>
                    Submit response
                  </button>
                  {notes.length === 0 ? <p className="mt-1 text-xs text-zinc-500">Add at least one evidence note first.</p> : null}
                </form>
                <div className="border-t border-zinc-100 pt-4">
                  <ReasonForm
                    action={acceptDisputeLoss}
                    submitLabel={needsFinance ? "Accept loss (needs finance)" : "Accept loss"}
                    tone="danger"
                    fields={{ disputeId: dispute.id }}
                    placeholder="Why accept the loss?"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    {needsFinance
                      ? `Over ${formatCents(ACCEPT_LOSS_APPROVAL_CENTS)}: a finance approver has to agree.`
                      : `Up to ${formatCents(ACCEPT_LOSS_APPROVAL_CENTS)}: accepted immediately.`}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">Waiting for a disputes analyst.</p>
            )
          ) : dispute.status === "submitted" ? (
            worker ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <ReasonForm action={recordDisputeOutcome} submitLabel="Mark won" fields={{ disputeId: dispute.id, outcome: "won" }} placeholder="Network verdict" />
                <ReasonForm action={recordDisputeOutcome} submitLabel="Mark lost" tone="danger" fields={{ disputeId: dispute.id, outcome: "lost" }} placeholder="Network verdict" />
              </div>
            ) : (
              <p className="text-sm text-zinc-600">Response sent; waiting for the card network.</p>
            )
          ) : (
            <p className="text-sm text-zinc-600">Closed as {dispute.status.replace(/_/g, " ")}.</p>
          )}
        </Card>
        <Card title="Loss acceptance">
          {approvals.length === 0 ? <p className="text-sm text-zinc-600">No loss acceptance has needed finance.</p> : null}
          <div className="flex flex-col gap-4">
            {approvals.map((a: Approval) => (
              <div key={a.id}>
                <DescriptionList
                  items={[
                    ["Approval", <StatusBadge key="st" status={a.status} />],
                    ["Needs", a.permission],
                    ["Requested by", name(a.requested_by)],
                    ["Summary", a.summary],
                    ["Decided by", name(a.decided_by)],
                    ["Decided", when(a.decided_at)],
                    ["Decision reason", a.reason ?? "—"],
                  ]}
                />
              </div>
            ))}
          </div>
          {pending ? (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              {canDecide(user, pending) ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReasonForm
                    action={decideDisputeLoss}
                    submitLabel="Approve loss"
                    fields={{ disputeId: dispute.id, approvalId: pending.id, decision: "approve" }}
                    placeholder="Why approve?"
                  />
                  <ReasonForm
                    action={decideDisputeLoss}
                    submitLabel="Reject"
                    tone="danger"
                    fields={{ disputeId: dispute.id, approvalId: pending.id, decision: "reject" }}
                    placeholder="Why reject?"
                  />
                </div>
              ) : (
                <Alert tone={pending.requested_by === user.id ? "warning" : "info"}>
                  {pending.requested_by === user.id
                    ? "You asked to accept this loss, so someone else has to decide it."
                    : "Waiting for a finance approver."}
                </Alert>
              )}
            </div>
          ) : null}
        </Card>
      </div>

      <SectionLabel className="mt-10">Audit trail</SectionLabel>
      <Table<AuditRow>
        rows={trail}
        rowKey={(a) => a.id}
        empty="No audit rows yet."
        columns={[
          { header: "When", cell: (a) => when(a.ts) },
          { header: "Who", cell: (a) => name(a.actor_id) },
          { header: "Action", cell: (a) => <span>{a.action}</span> },
          { header: "Outcome", cell: (a) => <StatusBadge status={a.outcome} /> },
          {
            header: "Detail",
            cell: (a) => <code className="block max-w-xl truncate text-xs text-zinc-600" title={a.detail_json}>{a.detail_json}</code>,
          },
        ]}
      />
    </>
  );
}
