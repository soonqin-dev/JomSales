import { requireUser } from "../../../../lib/supabase/server";
import QuoteEditor from "./QuoteEditor";
export default async function Page() { await requireUser(); return <QuoteEditor />; }
