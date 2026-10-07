import { requireUser } from "../../../lib/supabase/server";
import Admin from "./Admin";
export default async function Page() { await requireUser(); return <Admin />; }
