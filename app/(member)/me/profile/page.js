import { requireUser } from "../../../../lib/supabase/server";
import Profile from "./Profile";
export default async function Page() { await requireUser(); return <Profile />; }
