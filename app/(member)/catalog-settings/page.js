import { requireUser } from "../../../lib/supabase/server";
import CatalogSettings from "./Settings";
export default async function Page() { await requireUser(); return <CatalogSettings />; }
