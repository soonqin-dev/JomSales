import { requireUser } from "../../lib/supabase/server";
import Customers from "./Customers";
export default async function Page(){await requireUser();return <Customers/>;}
