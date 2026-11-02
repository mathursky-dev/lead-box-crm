import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { leadCounts } from "../counts";
import { SourceList, type SourceRow } from "./source-list";

export const metadata = { title: "Manage Source" };

export default async function SettingsSources() {
  const cid = (await getSession())?.profile?.company_id ?? "";
  const sb = await createClient();
  const [{ data }, counts] = await Promise.all([
    sb.from("lb_sources").select("id,name,color,sort_order,is_active,is_system").eq("company_id", cid).order("sort_order").order("name"),
    leadCounts(),
  ]);
  return <SourceList rows={((data ?? []) as SourceRow[]).map((r) => ({ ...r, leads: counts.source[r.id] ?? 0 }))} />;
}
