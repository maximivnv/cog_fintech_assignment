import {
  Alert,
  PageHeader,
  StatusBadge,
  Table,
  buttonClass,
  findUser,
  getTool,
  listAudit,
  listAuditTools,
  requireUser,
  toolRegistry,
  type AuditRow,
  type Column,
  inputClass,
  linkClass,
} from "@/platform";

const LIMIT = 200;

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
}

function prettyDetail(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

const columns: Column<AuditRow>[] = [
  { header: "#", cell: (r) => <span className="font-mono text-xs text-zinc-500">{r.id}</span> },
  { header: "When", cell: (r) => <span className="whitespace-nowrap">{when(r.ts)}</span> },
  { header: "Actor", cell: (r) => findUser(r.actor_id)?.name ?? r.actor_id },
  { header: "Tool", cell: (r) => getTool(r.tool)?.manifest.name ?? r.tool },
  { header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
  { header: "Entity", cell: (r) => <span className="font-mono text-xs">{r.entity_id ?? "—"}</span> },
  { header: "Outcome", cell: (r) => <StatusBadge status={r.outcome} /> },
  {
    header: "Detail",
    cell: (r) => (
      <details>
        <summary className={`cursor-pointer ${linkClass}`}>view</summary>
        <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs">{prettyDetail(r.detail_json)}</pre>
      </details>
    ),
  },
];

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const user = await requireUser();
  if (!user.roles.includes("auditor")) {
    return (
      <>
        <PageHeader title="Audit log" />
        <Alert tone="error">Auditor only. Your roles: {user.roles.join(", ") || "none"}.</Alert>
      </>
    );
  }

  const params = await searchParams;
  const tool = typeof params.tool === "string" && params.tool ? params.tool : undefined;
  const rows = listAudit({ tool, limit: LIMIT });
  const tools = Array.from(new Set([...toolRegistry.map((t) => t.manifest.slug), ...listAuditTools()])).sort();

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every action, denial and failure on the platform. Rows are append-only: nothing here can be edited or deleted."
        actions={
          <form method="get" className="flex items-center gap-2 text-sm">
            <label htmlFor="tool" className="text-zinc-600">Tool</label>
            <select
              id="tool"
              name="tool"
              defaultValue={tool ?? ""}
              className={`${inputClass} w-auto`}
            >
              <option value="">All tools</option>
              {tools.map((slug) => (
                <option key={slug} value={slug}>
                  {getTool(slug)?.manifest.name ?? slug}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass.secondary}>Filter</button>
          </form>
        }
      />
      <p className="mb-2 text-sm text-zinc-500">
        {rows.length === LIMIT ? `Latest ${LIMIT} rows` : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
        {tool ? ` for ${getTool(tool)?.manifest.name ?? tool}` : ""}, newest first.
      </p>
      <Table rows={rows} columns={columns} rowKey={(r) => r.id} empty="No audit rows yet." />
    </>
  );
}
