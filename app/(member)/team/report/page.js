import { requireUser } from "../../../../lib/supabase/server";
import SalesReport from "../SalesReport";
export default async function Page() { await requireUser(); return <SalesReport />; }
