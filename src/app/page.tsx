import Link from "next/link";
import { Card, PageHeader, requireUser, toolsFor } from "@/platform";

export default async function Home() {
  const user = await requireUser();
  const tools = toolsFor(user);

  return (
    <>
      <PageHeader title={`Hello, ${user.name}`} description={`Roles: ${user.roles.join(", ")}`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <Link key={t.manifest.slug} href={`/tools/${t.manifest.slug}`} className="block">
            <Card className="h-full transition-colors hover:border-zinc-300">
              <h2 className="text-base font-semibold text-zinc-900">{t.manifest.name}</h2>
              <p className="mt-1 text-sm text-zinc-600">
                {Object.keys(t.manifest.permissions).length} permission
                {Object.keys(t.manifest.permissions).length === 1 ? "" : "s"}
              </p>
            </Card>
          </Link>
        ))}
        <Link href="/approvals" className="block">
          <Card className="h-full transition-colors hover:border-zinc-300">
            <h2 className="text-base font-semibold text-zinc-900">Approvals</h2>
            <p className="mt-1 text-sm text-zinc-600">Requests waiting on you, and your own.</p>
          </Card>
        </Link>
      </div>
      {tools.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">No tools are registered for your roles yet.</p>
      ) : null}
    </>
  );
}
