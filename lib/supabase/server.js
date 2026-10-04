import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseConfig } from "./config";

export async function requireUser() {
  const store = await cookies();
  const { url, publishableKey } = getSupabaseConfig();
  const client = createServerClient(url, publishableKey, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookies: { getAll: () => store.getAll(), setAll: () => {} }
  });
  // Never trust the unverified user embedded in a session cookie.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/account");
  return data.user;
}
