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
  listAudit,
  requireUser,
  type AuditRow,
  SectionLabel,
} from "@/platform";
import { getRefundDetail } from "@/tools/refunds/queries";
import { decideRefund } from "../actions";

const name = (id: string | null) => (id ? findUser(id)?.name ?? id : "—");
const when = (ts: string | null) => (ts ? new Date(ts).toLocaleString("en-US", { timeZone: "UTC" }) : "—");

export default async function RefundDetailPage({ params, searchParams }: PageProps<"/tools/refunds/[id]">) {
  const user = await requireUser();
  if (!can(user, "refunds:view")) {
    return <Alert tone="error">You don&apos;t have access to Refunds.</Alert>;
  }
  const { id } = await params;
  const { error } = await searchParams;
  const detail = getRefundDetail(id);
  if (!detail) notFound();
  const { refund, charge, approval } = detail;
  const trail = listAudit({ tool: "refunds", entityId: refund.id });
  const decidable = approval ? canDecide(user, approval) : false;
  const ownRequest = refund.requested_by === user.id;

  return (
    <>
      <PageHeader
        title={`Refund ${refund.id}`}
        description={<StatusBadge status={refund.status} />}
        actions={
          <Link href="/tools/refunds" className={buttonClass.secondary}>
            All refunds
          </Link>
        }
      />
      {typeof error === "string" && error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Request">
          <DescriptionList
            items={[
              ["Amount", <Money key="amt" cents={refund.amount_cents} />],
              ["Charge", `${charge.id} · ${charge.customer} · ${charge.description}`],
              ["Charge total", <Money key="tot" cents={charge.amount_cents} />],
              ["Refunded so far", <Money key="ref" cents={charge.refunded_cents} />],
              ["Reason", refund.reason],
              ["Requested by", name(refund.requested_by)],
              ["Requested", when(refund.created_at)],
              ["Processor refund", refund.payment_refund_id ?? "—"],
            ]}
          />
        </Card>
        <Card title="Decision">
          {approval ? (
            <DescriptionList
              items={[
                ["Approval", <StatusBadge key="st" status={approval.status} />],
                ["Needs", approval.permission],
                ["Decided by", name(approval.decided_by)],
                ["Decided", when(approval.decided_at)],
                ["Decision reason", approval.reason ?? "—"],
              ]}
            />
          ) : (
            <p className="text-sm text-zinc-600">Within the auto-approve limit; executed immediately.</p>
          )}
          {approval?.status === "pending" ? (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              {decidable ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReasonForm
                    action={decideRefund}
                    submitLabel="Approve"
                    fields={{ refundId: refund.id, approvalId: approval.id, decision: "approve" }}
                    placeholder="Why approve?"
                  />
                  <ReasonForm
                    action={decideRefund}
                    submitLabel="Reject"
                    tone="danger"
                    fields={{ refundId: refund.id, approvalId: approval.id, decision: "reject" }}
                    placeholder="Why reject?"
                  />
                </div>
              ) : (
                <Alert tone={ownRequest ? "warning" : "info"}>
                  {ownRequest
                    ? "You requested this refund, so someone else has to decide it."
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
          { header: "Action", cell: (a) => <span className="font-mono">{a.action}</span> },
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
