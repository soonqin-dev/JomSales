import { redirect } from "next/navigation";
// Interim: RPT still lives inside /team until it is split out (pages-spec §6).
export default function Page() { redirect("/team"); }
