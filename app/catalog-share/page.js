import { requireUser } from "../../lib/supabase/server";
import CatalogShare from "./CatalogShare";
export default async function Page(){await requireUser();return <CatalogShare/>;}
