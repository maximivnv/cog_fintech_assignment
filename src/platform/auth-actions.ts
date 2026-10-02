"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UID_COOKIE } from "./auth";
import { findUser } from "./users";

export async function loginAs(formData: FormData): Promise<void> {
  const id = formData.get("uid");
  const user = findUser(typeof id === "string" ? id : null);
  if (!user) redirect("/login?error=unknown_user");
  const store = await cookies();
  store.set(UID_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(UID_COOKIE);
  redirect("/login");
}
