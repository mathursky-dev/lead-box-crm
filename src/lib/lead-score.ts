import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { aiConfigured, scoreLead } from "./ai";

type Db = SupabaseClient;
type Msg = { direction: "in" | "out"; body: string | null; type: string; created_at: string };

/** Auto score at most once per lead in this window, and at most this many auto scores per company per day. */
const AUTO_GAP_MS = 10 * 60 * 1000;
const AUTO_DAILY_CAP = 300;

/** CRM facts that help the rating (status, value, follow-up …). Works with the user client (RLS) or the service client. */
export async function leadFacts(db: Db, leadId: string) {
  const { data: l } = await db.from("lb_leads")
    .select("lead_no,status_category,priority,expected_value,created_at,last_activity_at,next_followup_at,status:lb_lead_statuses(name),product:lb_products(name),source:lb_sources(name)")
    .eq("id", leadId).maybeSingle();
  if (!l) return "";
  const name = (x: unknown) => (x as { name?: string } | null)?.name ?? "—";
  return [
    `Lead LB-${l.lead_no}; status: ${name(l.status)} (${l.status_category}); priority: ${l.priority}`,
    `Product: ${name(l.product)}; source: ${name(l.source)}; expected value: ${l.expected_value ?? "—"}`,
    `Created ${String(l.created_at).slice(0, 10)}; last activity ${String(l.last_activity_at).slice(0, 16)}; next follow-up ${l.next_followup_at ? String(l.next_followup_at).slice(0, 16) : "none"}`,
  ].join("\n");
}

/** Last 40 messages of a conversation, oldest first. */
export async function recentMessages(db: Db, convId: string) {
  const { data } = await db.from("lb_messages").select("direction,body,type,created_at").eq("conversation_id", convId)
    .order("created_at", { ascending: false }).limit(40);
  return ((data ?? []) as Msg[]).reverse();
}

async function companyAllowsAuto(db: Db, companyId: string) {
  const { data: co } = await db.from("lb_companies").select("ai_enabled,ai_auto_score").eq("id", companyId).maybeSingle();
  if (!co?.ai_enabled || co.ai_auto_score === false) return false;
  // Same rule as lb_my_features: internal / no plan = every feature; otherwise the plan's list.
  const { data: b } = await db.from("lb_billing").select("plan,plan_id,suspended_at").eq("company_id", companyId).maybeSingle();
  if (b?.suspended_at) return false;
  if (b && b.plan !== "internal" && b.plan_id) {
    const { data: p } = await db.from("lb_plans").select("features").eq("id", b.plan_id).maybeSingle();
    if (!((p?.features ?? []) as string[]).includes("ai")) return false;
  }
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await db.from("lb_ai_outputs").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).eq("kind", "score").is("created_by", null).gte("created_at", since);
  return (count ?? 0) < AUTO_DAILY_CAP;
}

/**
 * Re-score the leads behind these conversations after the customer wrote (called from the
 * WhatsApp webhook, after the response). Best effort: errors are swallowed so delivery never breaks.
 */
export async function autoScoreConversations(convIds: string[]) {
  if (!convIds.length || !aiConfigured() || !hasServiceRole()) return;
  const db = createAdminClient();
  const allowed = new Map<string, boolean>();
  for (const convId of [...new Set(convIds)].slice(0, 10)) {
    try {
      const { data: conv } = await db.from("lb_conversations").select("id,company_id,lead_id,customer:lb_customers(name,wa_profile_name)").eq("id", convId).maybeSingle();
      if (!conv?.lead_id) continue;
      const { data: lead } = await db.from("lb_leads").select("id,ai_scored_at,deleted_at,status_category").eq("id", conv.lead_id).maybeSingle();
      if (!lead || lead.deleted_at || ["won", "lost"].includes(lead.status_category as string)) continue;
      if (lead.ai_scored_at && Date.now() - new Date(lead.ai_scored_at as string).getTime() < AUTO_GAP_MS) continue;
      if (!allowed.has(conv.company_id)) allowed.set(conv.company_id, await companyAllowsAuto(db, conv.company_id));
      if (!allowed.get(conv.company_id)) continue;
      const msgs = await recentMessages(db, conv.id);
      if (!msgs.some((m) => m.direction === "in")) continue;
      const cu = conv.customer as unknown as { name: string | null; wa_profile_name: string | null } | null;
      const r = await scoreLead(cu?.name || cu?.wa_profile_name || "Customer", msgs, await leadFacts(db, lead.id));
      const upto = msgs[msgs.length - 1].created_at;
      await db.from("lb_leads").update({ ai_score: r.score, ai_score_points: r.points, ai_score_reason: r.reason, ai_next_step: r.next_step, ai_scored_at: new Date().toISOString(), ai_scored_upto: upto }).eq("id", lead.id);
      await db.from("lb_ai_outputs").insert({ company_id: conv.company_id, conversation_id: conv.id, lead_id: lead.id, kind: "score",
        content: JSON.stringify({ score: r.score, points: r.points, reason: r.reason, next_step: r.next_step, auto: true }), model: r.model });
    } catch (e) {
      console.warn("auto score failed", convId, (e as Error).message);
    }
  }
}
