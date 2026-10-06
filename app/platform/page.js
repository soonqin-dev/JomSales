import { requireUser } from "../../lib/supabase/server";
import Platform from "./Platform";
export default async function PlatformPage() {
  await requireUser();
  return <Platform />;
}
