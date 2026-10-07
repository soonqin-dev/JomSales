import { requireUser } from "../../../lib/supabase/server";
import CloudCatalog from "./CloudCatalog";
export default async function Page() { await requireUser(); return <CloudCatalog />; }
