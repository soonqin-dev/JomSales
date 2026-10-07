import { requireUser } from "../../../../lib/supabase/server";
import { SecurityPanel } from "../../../account-settings";
import { TopBar } from "../../../ui";

export default async function Page() {
  await requireUser();
  return <main className="app-main"><TopBar title="账号安全" back="/me" /><SecurityPanel /></main>;
}
