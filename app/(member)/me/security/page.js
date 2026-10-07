import { redirect } from "next/navigation";
// Interim: SEC is served by /settings until the dedicated screen lands (pages-spec §4).
export default function Page() { redirect("/settings"); }
