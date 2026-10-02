import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findUser, type User } from "./users";

export const UID_COOKIE = "uid";

/** The mock-SSO user from the `uid` cookie, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  return findUser(store.get(UID_COOKIE)?.value);
}

/** Like `getCurrentUser()` but sends anonymous visitors to /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
