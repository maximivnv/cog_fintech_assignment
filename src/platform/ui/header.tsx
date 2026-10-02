import Link from "next/link";
import { getCurrentUser } from "../auth";
import { logout } from "../auth-actions";
import { toolsFor } from "../registry";
import { NavLink } from "./nav-link";
import { buttonClass } from "./primitives";

export async function Header() {
  const user = await getCurrentUser();
  const tools = toolsFor(user);
  const isAuditor = user?.roles.includes("auditor") ?? false;

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 px-6 pt-3 md:h-14 md:flex-nowrap md:pt-0">
        <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight text-zinc-900">
          Internal Tools
        </Link>
        <nav aria-label="Tools" className="order-last flex h-10 w-full items-center gap-6 overflow-x-auto md:order-none md:h-full md:w-auto">
          {tools.map((t) => (
            <NavLink key={t.manifest.slug} href={`/tools/${t.manifest.slug}`}>
              {t.manifest.name}
            </NavLink>
          ))}
          {user ? <NavLink href="/approvals">Approvals</NavLink> : null}
          {isAuditor ? <NavLink href="/audit">Audit log</NavLink> : null}
        </nav>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm md:shrink-0 md:flex-nowrap">
          {user ? (
            <>
              <span className="text-right leading-tight">
                <span className="font-medium text-zinc-900">{user.name}</span>{" "}
                <span className="text-zinc-500">({user.roles.join(", ")})</span>
              </span>
              <span aria-hidden className="h-4 w-px bg-zinc-200" />
              <Link href="/login" className="text-zinc-500 transition-colors hover:text-zinc-900">
                Switch user
              </Link>
              <form action={logout}>
                <button type="submit" className="text-zinc-500 transition-colors hover:text-zinc-900">
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
