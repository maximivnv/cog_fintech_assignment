import Link from "next/link";
import { Alert, Money, PageHeader, StatusBadge, Table, buttonClass, can, findUser, requireUser, filterLinkClass, linkClass } from "@/platform";
import { REFUND_STATUSES, listRefunds, type Refund, type RefundStatus } from "@/tools/refunds/queries";

function isStatus(s: string | undefined): s is RefundStatus {
  return REFUND_STATUSES.includes(s as RefundStatus);
}

export default async function RefundsPage({ searchParams }: PageProps<"/tools/refunds">) {
  const user = await requireUser();
  if (!can(user, "refunds:view")) {
    return <Alert tone="error">You don&apos;t have access to Refunds.</Alert>;
  }
  const { status } = await searchParams;
  const filter = typeof status === "string" && isStatus(status) ? status : undefined;
  const rows = listRefunds(filter ? { status: filter } : {});

  const filterLink = (label: string, value?: RefundStatus) => {
    const active = value === filter;
    return (
      <Link
        key={label}
        href={value ? `/tools/refunds?status=${value}` : "/tools/refunds"}
        className={filterLinkClass(active)}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Up to $100 executes immediately. $100.01 to $5,000 needs a finance approver. Over $5,000: escalate to finance."
        actions={
          can(user, "refunds:request") ? (
            <Link href="/tools/refunds/new" className={buttonClass.primary}>
              New request
            </Link>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-1">
        {filterLink("All")}
        {REFUND_STATUSES.map((s) => filterLink(s.replace(/_/g, " "), s))}
      </div>
      <Table<Refund>
        rows={rows}
        rowKey={(r) => r.id}
        empty="No refunds match this filter."
        columns={[
          {
            header: "Refund",
            cell: (r) => (
              <Link href={`/tools/refunds/${r.id}`} className={linkClass}>
                {r.id}
              </Link>
            ),
          },
          { header: "Charge", cell: (r) => <span className="text-zinc-600">{r.charge_id}</span> },
          { header: "Amount", align: "right", cell: (r) => <Money cents={r.amount_cents} /> },
          { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          { header: "Requested by", cell: (r) => findUser(r.requested_by)?.name ?? r.requested_by },
          { header: "Reason", cell: (r) => <span className="text-zinc-600">{r.reason}</span> },
          { header: "Created", className: "whitespace-nowrap", cell: (r) => new Date(r.created_at).toLocaleString("en-US", { timeZone: "UTC" }) },
        ]}
      />
    </>
  );
}
