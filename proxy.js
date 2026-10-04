import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { getSupabaseConfig } from "./lib/supabase/config";

export async function proxy(request) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabaseConfig();
  const client = createServerClient(url, publishableKey, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: entries => {
        entries.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        entries.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  let user = null;
  try { const result = await client.auth.getUser(); if (!result.error) user = result.data.user; }
  catch { /* Fail closed on network/auth failures. */ }
  const publicPage = ["/account", "/join", "/auth/callback"].includes(request.nextUrl.pathname);
  if (!publicPage && !user) {
    const redirected = NextResponse.redirect(new URL("/account", request.url));
    response.cookies.getAll().forEach(cookie => redirected.cookies.set(cookie));
    response = redirected;
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export const config = { matcher: ["/", "/account", "/join", "/auth/callback", "/cloud", "/team", "/brand", "/quotations", "/migration"] };
