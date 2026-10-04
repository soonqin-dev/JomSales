import { requireUser } from "../../lib/supabase/server";
import Team from "./Team";
export default async function Page() { await requireUser(); return <Team />; }
