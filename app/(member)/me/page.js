import { requireUser } from "../../../lib/supabase/server";
import Me from "./Me";
export default async function Page() { await requireUser(); return <Me />; }
