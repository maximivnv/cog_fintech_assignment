import Link from "next/link";
import { getCurrentUser } from "../auth";
import { logout } from "../auth-actions";
import { toolsFor } from "../registry";
import { buttonClass } from "./primitives";

export async function Header() {
  const user = await getCurrentUser();
  const tools = toolsFor(user);
  const isAuditor = user?.roles.includes("auditor") ?? false;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-base font-semibold text-slate-900">
          Internal Tools
        </Link>
        <nav aria-label="Tools" className="flex flex-wrap items-center gap-x-4 text-sm">
          {tools.map((t) => (
            <Link key={t.manifest.slug} href={`/tools/${t.manifest.slug}`} className="text-slate-700 hover:text-slate-900">
              {t.manifest.name}
            </Link>
          ))}
          {user ? (
            <Link href="/approvals" className="text-slate-700 hover:text-slate-900">
              Approvals
            </Link>
          ) : null}
          {isAuditor ? (
            <Link href="/audit" className="text-slate-700 hover:text-slate-900">
              Audit log
            </Link>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="text-slate-700">
                <span className="font-medium text-slate-900">{user.name}</span>{" "}
                <span className="text-slate-500">({user.roles.join(", ")})</span>
              </span>
              <Link href="/login" className={buttonClass.secondary}>
                Switch user
              </Link>
              <form action={logout}>
                <button type="submit" className="text-slate-500 hover:text-slate-800">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className={buttonClass.primary}>
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
