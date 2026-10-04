import { requireUser } from "../../lib/supabase/server";
import History from "./History";
export default async function Page() { await requireUser(); return <History />; }
