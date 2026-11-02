import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReasonList, type ReasonRow } from "./reason-list";

export const metadata = { title: "Lost reasons" };

export default async function SettingsLostReasons() {
  const cid = (await getSession())?.profile?.company_id ?? "";
  const sb = await createClient();
  const [{ data, error }, used] = await Promise.all([
    sb.from("lb_lost_reasons").select("id,name,category,is_active,sort_order").eq("company_id", cid).order("sort_order").order("name"),
    sb.from("lb_leads").select("lost_reason").eq("company_id", cid).in("status_category", ["lost", "invalid"]).not("lost_reason", "is", null).limit(5000),
  ]);
  const counts: Record<string, number> = {};
  for (const r of used.data ?? []) {
    const k = String(r.lost_reason).trim().toLowerCase();
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const rows = ((data ?? []) as ReasonRow[]).map((r) => ({ ...r, leads: counts[r.name.trim().toLowerCase()] ?? 0 }));
  return <ReasonList rows={rows} missing={!!error} />;
}
