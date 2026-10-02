import Link from "next/link";
import {
  Alert,
  PageHeader,
  StatusBadge,
  Table,
  approvalsRequestedBy,
  approvalsToDecide,
  findUser,
  getTool,
  requireUser,
  type Approval,
  type Column,
} from "@/platform";
import { DecisionForm } from "./decision-form";

function userName(id: string | null): string {
  if (!id) return "—";
  return findUser(id)?.name ?? id;
}

function toolName(slug: string): string {
  return getTool(slug)?.manifest.name ?? slug;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC" : "—";
}

const requestColumns: Column<Approval>[] = [
  { header: "Tool", cell: (a) => <Link href={`/tools/${a.tool}`} className="underline-offset-2 hover:underline">{toolName(a.tool)}</Link> },
  { header: "Request", cell: (a) => <span>{a.summary}<span className="ml-2 font-mono text-xs text-slate-500">{a.entity_id}</span></span> },
  { header: "Requested by", cell: (a) => userName(a.requested_by) },
  { header: "Requested", cell: (a) => when(a.created_at) },
];

export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  const user = await requireUser();
  const { error, ok } = await searchParams;
  const toDecide = approvalsToDecide(user);
  const mine = approvalsRequestedBy(user);

  const decideColumns: Column<Approval>[] = [
    ...requestColumns,
    { header: "Decision", cell: (a) => <DecisionForm approvalId={a.id} /> },
  ];

  const mineColumns: Column<Approval>[] = [
    requestColumns[0],
    requestColumns[1],
    { header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
    { header: "Decided by", cell: (a) => userName(a.decided_by) },
    { header: "Reason", cell: (a) => a.reason ?? "—" },
    { header: "Requested", cell: (a) => when(a.created_at) },
  ];

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Requests waiting on your decision, and the ones you made. You never see your own requests in the first list."
      />
      {typeof error === "string" ? <div className="mb-4"><Alert tone="error">{error}</Alert></div> : null}
      {typeof ok === "string" ? <div className="mb-4"><Alert tone="success">{ok}</Alert></div> : null}

      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          To decide <span className="ml-1 text-sm font-normal text-slate-500">({toDecide.length})</span>
        </h2>
        <Table rows={toDecide} columns={decideColumns} rowKey={(a) => a.id} empty="Nothing waiting on you." />
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          My requests <span className="ml-1 text-sm font-normal text-slate-500">({mine.length})</span>
        </h2>
        <Table rows={mine} columns={mineColumns} rowKey={(a) => a.id} empty="You have not requested anything yet." />
      </section>
    </>
  );
}
