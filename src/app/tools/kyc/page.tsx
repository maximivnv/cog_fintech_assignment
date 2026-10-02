import Link from "next/link";
import { Alert, MaskedValue, PageHeader, StatusBadge, Table, can, findUser, requireUser } from "@/platform";
import { HIGH_RISK_SCORE } from "@/tools/kyc/manifest";
import { KYC_STATUSES, listCases, type KycCase, type KycStatus } from "@/tools/kyc/queries";

function isStatus(s: string | undefined): s is KycStatus {
  return KYC_STATUSES.includes(s as KycStatus);
}

export default async function KycQueuePage({ searchParams }: PageProps<"/tools/kyc">) {
  const user = await requireUser();
  if (!can(user, "kyc:view")) {
    return <Alert tone="error">You don&apos;t have access to KYC review.</Alert>;
  }
  const { status, mine } = await searchParams;
  const filter = typeof status === "string" && isStatus(status) ? status : undefined;
  const onlyMine = mine === "1";
  const rows = listCases({ ...(filter ? { status: filter } : {}), ...(onlyMine ? { assigneeId: user.id } : {}) });

  const href = (s?: KycStatus, m = onlyMine) => {
    const q = new URLSearchParams();
    if (s) q.set("status", s);
    if (m) q.set("mine", "1");
    const qs = q.toString();
    return `/tools/kyc${qs ? `?${qs}` : ""}`;
  };
  const chip = (label: string, to: string, active: boolean) => (
    <Link
      key={label}
      href={to}
      className={`rounded-md px-2 py-1 text-sm ${active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="KYC review"
        description={`Highest risk first. Score ≥ ${HIGH_RISK_SCORE} or a watchlist hit is high risk: approving it needs a KYC lead. Claim a case to decide it.`}
      />
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {chip("All", href(undefined), filter === undefined)}
        {KYC_STATUSES.map((s) => chip(s.replace(/_/g, " "), href(s), s === filter))}
        {can(user, "kyc:decide") ? (
          <>
            <span className="mx-2 h-4 border-l border-slate-200" />
            {chip("Assigned to me", href(filter, !onlyMine), onlyMine)}
          </>
        ) : null}
      </div>
      <Table<KycCase>
        rows={rows}
        rowKey={(c) => c.id}
        empty="No cases match this filter."
        columns={[
          {
            header: "Case",
            cell: (c) => (
              <Link href={`/tools/kyc/${c.id}`} className="font-mono text-slate-900 underline-offset-2 hover:underline">
                {c.id}
              </Link>
            ),
          },
          { header: "Applicant", cell: (c) => c.applicant_name },
          { header: "Country", cell: (c) => <span className="font-mono">{c.country}</span> },
          { header: "Date of birth", cell: (c) => <MaskedValue value={c.date_of_birth} /> },
          { header: "Document", cell: (c) => <MaskedValue value={c.document_number} /> },
          {
            header: "Risk",
            align: "right",
            cell: (c) => (
              <span className={`font-mono ${c.high_risk ? "font-semibold text-red-700" : ""}`}>
                {c.risk_score}
                {c.watchlist_hit ? <span title="Watchlist hit"> ⚑</span> : null}
              </span>
            ),
          },
          { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
          { header: "Assignee", cell: (c) => (c.assignee_id ? findUser(c.assignee_id)?.name ?? c.assignee_id : "—") },
          { header: "Created", cell: (c) => new Date(c.created_at).toLocaleString("en-US", { timeZone: "UTC" }) },
        ]}
      />
    </>
  );
}
