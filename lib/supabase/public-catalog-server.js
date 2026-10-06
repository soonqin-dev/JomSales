import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal || AbortSignal.timeout(15000) }) } };
// Deliberately independent from the visitor's login cookies. Public RPCs always run as anon.
export function catalogReader() {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, options);
}
export function catalogImageReader() {
  const { url } = getSupabaseConfig();
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key?.startsWith("sb_secret_")) throw new Error("Catalog image server not configured");
  // This client is used ONLY to download the specific photo authorized by the anon RPC.
  return createClient(url, key, options);
}
