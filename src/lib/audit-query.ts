import "server-only";
import type { createClient } from "./supabase/server";
import { istMidnight } from "./dates";

// Audit log filters shared by the page and its Excel export.
export type AuditFilters = { who?: string; type?: string; q?: string; from?: string; to?: string; lead?: string; id?: string };
export const AUDIT_TYPES = { lead: "Leads", customer: "Customers", user: "Users", settings: "Settings & admin" } as const;
const UUID = /^[0-9a-f-]{36}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Runs the filtered query for rows [a, b]. */
export async function auditQuery(sb: Awaited<ReturnType<typeof createClient>>, companyId: string, f: AuditFilters, a: number, b: number) {
  // LB-123 → that lead's history
  let leadId = f.id && UUID.test(f.id) ? f.id : null;
  const no = f.lead?.replace(/\D/g, "");
  if (!leadId && no) {
    const { data } = await sb.from("lb_leads").select("id").eq("company_id", companyId).eq("lead_no", Number(no)).maybeSingle();
    leadId = (data?.id as string | undefined) ?? "00000000-0000-0000-0000-000000000000";
  }
  let q = sb.from("lb_audit_log")
    .select("id,action,entity,entity_id,data,created_at,actor:lb_profiles!lb_audit_log_actor_id_fkey(full_name)", { count: "exact" })
    .eq("company_id", companyId).order("created_at", { ascending: false });
  if (leadId) q = q.eq("entity_id", leadId);
  if (f.who === "system") q = q.is("actor_id", null);
  else if (f.who && UUID.test(f.who)) q = q.eq("actor_id", f.who);
  if (f.type === "settings") q = q.not("entity", "in", "(lead,customer,user)");
  else if (f.type && f.type in AUDIT_TYPES) q = q.eq("entity", f.type);
  if (f.q?.trim()) q = q.ilike("action", `%${f.q.trim().replace(/[%_,()]/g, "")}%`);
  if (f.from && YMD.test(f.from)) q = q.gte("created_at", istMidnight(f.from).toISOString());
  if (f.to && YMD.test(f.to)) q = q.lt("created_at", new Date(istMidnight(f.to).getTime() + 86400000).toISOString());
  return await q.range(a, b);
}
