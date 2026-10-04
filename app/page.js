import { redirect } from "next/navigation";
import { requireUser } from "../lib/supabase/server";
export default async function Home() { await requireUser(); redirect("/cloud"); }
