import Link from "next/link";
import { Alert, Money, PageHeader, StatusBadge, Table, can, requireUser } from "@/platform";
import { DISPUTE_STATUSES, listDisputes, type Dispute, type DisputeStatus } from "@/tools/disputes/queries";
import { DaysLeft } from "./days-left";

function isStatus(s: string | undefined): s is DisputeStatus {
  return DISPUTE_STATUSES.includes(s as DisputeStatus);
}

export default async function DisputesPage({ searchParams }: PageProps<"/tools/disputes">) {
  const user = await requireUser();
  if (!can(user, "disputes:view")) {
    return <Alert tone="error">You don&apos;t have access to Disputes.</Alert>;
  }
  const { status } = await searchParams;
  const filter = typeof status === "string" && isStatus(status) ? status : undefined;
  const rows = listDisputes(filter ? { status: filter } : {});

  const filterLink = (label: string, value?: DisputeStatus) => {
    const active = value === filter;
    return (
      <Link
        key={label}
        href={value ? `/tools/disputes?status=${value}` : "/tools/disputes"}
        className={`rounded-md px-2 py-1 text-sm ${active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Chargebacks from the card networks, soonest response deadline first. Accepting a loss over $500 needs a finance approver."
      />
      <div className="mb-3 flex flex-wrap gap-1">
        {filterLink("All")}
        {DISPUTE_STATUSES.map((s) => filterLink(s.replace(/_/g, " "), s))}
      </div>
      <Table<Dispute>
        rows={rows}
        rowKey={(d) => d.id}
        empty="No disputes match this filter."
        columns={[
          {
            header: "Dispute",
            cell: (d) => (
              <Link href={`/tools/disputes/${d.id}`} className="font-mono text-slate-900 underline-offset-2 hover:underline">
                {d.id}
              </Link>
            ),
          },
          { header: "Charge", cell: (d) => <span className="font-mono">{d.charge_id}</span> },
          { header: "Customer", cell: (d) => d.customer },
          { header: "Amount", align: "right", cell: (d) => <Money cents={d.amount_cents} /> },
          { header: "Reason", cell: (d) => <StatusBadge status={d.reason} tone="neutral" /> },
          { header: "Deadline", cell: (d) => <span className="tabular-nums">{d.response_deadline}</span> },
          { header: "Days left", cell: (d) => <DaysLeft dispute={d} /> },
          {
            header: "Status",
            cell: (d) => (
              <span className="inline-flex items-center gap-1">
                <StatusBadge status={d.status} />
                {d.status === "needs_response" && d.approval_id ? <StatusBadge status="pending finance" /> : null}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
