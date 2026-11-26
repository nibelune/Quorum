import { resolve } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ fetch }) => {
  const session: unknown = await (await fetch("/api/auth/get-session")).json();
  if (!session) redirect(307, resolve("/login"));
};
