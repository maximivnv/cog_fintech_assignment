import { Alert, Card, PageHeader, USERS, buttonClass, getCurrentUser, loginAs } from "@/platform";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const current = await getCurrentUser();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Log in" description="Mock login. Production uses the company's SSO." />
      {error ? <div className="mb-4"><Alert tone="error">That user does not exist.</Alert></div> : null}
      <Card>
        <ul className="divide-y divide-slate-100">
          {USERS.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="font-medium text-slate-900">
                  {u.name}
                  {current?.id === u.id ? <span className="ml-2 text-xs text-slate-500">(current)</span> : null}
                </div>
                <div className="text-sm text-slate-500">{u.roles.join(", ")}</div>
              </div>
              <form action={loginAs}>
                <input type="hidden" name="uid" value={u.id} />
                <button type="submit" className={buttonClass.secondary}>
                  Continue as {u.name}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
