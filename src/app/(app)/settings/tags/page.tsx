import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { leadCounts } from "../counts";
import { TagList, type TagRow } from "./tag-list";

export const metadata = { title: "Tags" };

export default async function SettingsTags() {
  const cid = (await getSession())?.profile?.company_id ?? "";
  const sb = await createClient();
  const [{ data }, counts] = await Promise.all([
    sb.from("lb_tags").select("id,name,color,description,created_at").eq("company_id", cid).order("created_at", { ascending: false }),
    leadCounts(),
  ]);
  return <TagList rows={((data ?? []) as TagRow[]).map((r) => ({ ...r, leads: counts.tag[r.id] ?? 0 }))} />;
}
