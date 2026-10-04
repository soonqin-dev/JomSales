import { requireUser } from "../../lib/supabase/server";
import Migration from "./Migration";
export default async function Page() { await requireUser(); return <Migration />; }
