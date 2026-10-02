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
  SectionLabel,
  linkClass,
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
  { header: "Tool", cell: (a) => <Link href={`/tools/${a.tool}`} className={linkClass}>{toolName(a.tool)}</Link> },
  { header: "Request", cell: (a) => <span>{a.summary}<span className="ml-2 font-mono text-xs text-zinc-500">{a.entity_id}</span></span> },
  { header: "Requested by", cell: (a) => userName(a.requested_by) },
  { header: "Requested", className: "whitespace-nowrap", cell: (a) => when(a.created_at) },
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
    { header: "Requested", className: "whitespace-nowrap", cell: (a) => when(a.created_at) },
  ];

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Requests waiting on your decision, and the ones you made. You never see your own requests in the first list."
      />
      {typeof error === "string" ? <div className="mb-4"><Alert tone="error">{error}</Alert></div> : null}
      {typeof ok === "string" ? <div className="mb-4"><Alert tone="success">{ok}</Alert></div> : null}

      <section className="mb-10">
        <SectionLabel>
          To decide <span className="ml-1 tabular-nums text-zinc-400">({toDecide.length})</span>
        </SectionLabel>
        <Table rows={toDecide} columns={decideColumns} rowKey={(a) => a.id} empty="Nothing waiting on you." />
      </section>

      <section>
        <SectionLabel>
          My requests <span className="ml-1 tabular-nums text-zinc-400">({mine.length})</span>
        </SectionLabel>
        <Table rows={mine} columns={mineColumns} rowKey={(a) => a.id} empty="You have not requested anything yet." />
      </section>
    </>
  );
}
