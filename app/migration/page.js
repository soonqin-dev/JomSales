import { requireUser } from "../../lib/supabase/server";
import { redirect } from "next/navigation";

// Compatibility only: retired bookmarks lead back to the cloud workspace.
export default async function Page({ searchParams }) {
  await requireUser();
  const { company } = await searchParams;
  const validCompany = typeof company === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(company);
  redirect(validCompany ? `/cloud?company=${encodeURIComponent(company)}` : "/cloud");
}
