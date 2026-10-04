import { requireUser } from "../../lib/supabase/server";
import Brand from "./Brand";
export default async function Page() { await requireUser(); return <Brand />; }
