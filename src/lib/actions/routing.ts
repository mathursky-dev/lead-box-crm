"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { LANG_CODES } from "@/lib/languages";

type Res = { error?: string; ok?: string };
const PATH = "/admin/allocation";
const id = z.uuid();
const ratio = z.coerce.number().int().min(1, "Ratio must be 1 or more").max(100, "Ratio can be at most 100");
const maxDay = z.union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().min(1, "Max / day must be 1 or more").max(10000)])
  .transform((v) => (v === "" || v == null ? null : v));

async function ctx() {
  const { profile: me } = await requireAdmin();
  return { me, sb: await createClient() };
}
type SB = Awaited<ReturnType<typeof createClient>>;

async function audit(companyId: string, actorId: string, action: string, entityId: string | null, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity: "allocation", entity_id: entityId, data });
}

async function ownRule(sb: SB, ruleId: string, companyId: string) {
  if (!id.safeParse(ruleId).success) return false;
  const { data } = await sb.from("lb_route_rules").select("id").eq("id", ruleId).eq("company_id", companyId).maybeSingle();
  return !!data;
}

/** Keep only ids that belong to this company's table. */
async function ownIds(sb: SB, table: "lb_products" | "lb_sources", companyId: string, ids: string[]) {
  const clean = [...new Set(ids.filter((x) => id.safeParse(x).success))];
  if (!clean.length) return [];
  const { data } = await sb.from(table).select("id").eq("company_id", companyId).in("id", clean);
  return (data ?? []).map((r) => r.id as string);
}

const ruleInput = z.object({
  name: z.string().trim().min(1, "Give the rule a name").max(60),
  priority: z.coerce.number().int().min(1, "Priority must be 1 or more").max(1000),
  products: z.array(z.string()).max(100),
  languages: z.array(z.string()).max(20),
  sources: z.array(z.string()).max(100),
  mode: z.enum(["ratio", "least_load"]),
});
export type RuleInput = z.input<typeof ruleInput>;

/** Create or edit a routing rule (products / languages / sources it matches, and how it picks users). */
export async function saveRouteRule(ruleId: string | null, input: RuleInput): Promise<Res> {
  const { me, sb } = await ctx();
  const p = ruleInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const products = await ownIds(sb, "lb_products", me.company_id, p.data.products);
  const sources = await ownIds(sb, "lb_sources", me.company_id, p.data.sources);
  const languages = [...new Set(p.data.languages.filter((l) => LANG_CODES.includes(l)))];
  const row = {
    name: p.data.name, priority: p.data.priority, pick_mode: p.data.mode,
    product_ids: products.length ? products : null, languages: languages.length ? languages : null, source_ids: sources.length ? sources : null,
    updated_at: new Date().toISOString(),
  };
  if (ruleId) {
    if (!(await ownRule(sb, ruleId, me.company_id))) return { error: "Invalid rule." };
    const { error } = await sb.from("lb_route_rules").update(row).eq("id", ruleId).eq("company_id", me.company_id);
    if (error) return { error: error.message };
    await audit(me.company_id, me.id, "routing.rule_update", ruleId, row);
    revalidatePath(PATH);
    return { ok: "Rule saved." };
  }
  const { data, error } = await sb.from("lb_route_rules").insert({ company_id: me.company_id, is_active: true, ...row }).select("id").single();
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "routing.rule_add", data.id, row);
  revalidatePath(PATH);
  return { ok: "Rule added. Now add users to it." };
}

export async function setRouteRuleActive(ruleId: string, active: boolean): Promise<Res> {
  const { me, sb } = await ctx();
  if (!(await ownRule(sb, ruleId, me.company_id))) return { error: "Invalid rule." };
  const { error } = await sb.from("lb_route_rules").update({ is_active: active }).eq("id", ruleId).eq("company_id", me.company_id);
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, active ? "routing.rule_on" : "routing.rule_off", ruleId);
  revalidatePath(PATH);
  return { ok: active ? "Rule on." : "Rule off." };
}

export async function deleteRouteRule(ruleId: string): Promise<Res> {
  const { me, sb } = await ctx();
  if (!(await ownRule(sb, ruleId, me.company_id))) return { error: "Invalid rule." };
  const { error } = await sb.from("lb_route_rules").delete().eq("id", ruleId).eq("company_id", me.company_id);
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "routing.rule_delete", ruleId);
  revalidatePath(PATH);
  return { ok: "Rule deleted." };
}

async function resetTurns(sb: SB, ruleId: string, companyId: string) {
  await sb.from("lb_route_members").update({ rr_weight: 0 }).eq("rule_id", ruleId).eq("company_id", companyId);
}

export async function addRouteMember(ruleId: string, input: { userId: string; ratio: string; maxPerDay: string }): Promise<Res> {
  const { me, sb } = await ctx();
  const p = z.object({ userId: z.uuid("Select a user"), ratio, maxPerDay: maxDay })
    .safeParse({ userId: input.userId, ratio: input.ratio || "1", maxPerDay: input.maxPerDay });
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (!(await ownRule(sb, ruleId, me.company_id))) return { error: "Invalid rule." };
  const { data: user } = await sb.from("lb_profiles").select("id").eq("id", p.data.userId).eq("company_id", me.company_id).maybeSingle();
  if (!user) return { error: "Invalid user." };
  const { error } = await sb.from("lb_route_members").insert({
    rule_id: ruleId, company_id: me.company_id, user_id: p.data.userId, ratio: p.data.ratio, max_per_day: p.data.maxPerDay,
  });
  if (error) return { error: error.code === "23505" ? "This user is already added." : error.message };
  await resetTurns(sb, ruleId, me.company_id);
  await audit(me.company_id, me.id, "routing.user_add", ruleId, p.data);
  revalidatePath(PATH);
  return { ok: "User added." };
}

export async function updateRouteMember(memberId: string, input: { ratio: string; maxPerDay: string }): Promise<Res> {
  const { me, sb } = await ctx();
  const p = z.object({ memberId: id, ratio, maxPerDay: maxDay }).safeParse({ memberId, ratio: input.ratio, maxPerDay: input.maxPerDay });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { data, error } = await sb.from("lb_route_members").update({ ratio: p.data.ratio, max_per_day: p.data.maxPerDay })
    .eq("id", memberId).eq("company_id", me.company_id).select("rule_id").single();
  if (error) return { error: error.message };
  await resetTurns(sb, data.rule_id, me.company_id);
  await audit(me.company_id, me.id, "routing.user_update", data.rule_id, p.data);
  revalidatePath(PATH);
  return { ok: "Saved." };
}

export async function setRouteMemberActive(memberId: string, active: boolean): Promise<Res> {
  const { me, sb } = await ctx();
  if (!id.safeParse(memberId).success) return { error: "Invalid user." };
  const { data, error } = await sb.from("lb_route_members").update({ is_active: active })
    .eq("id", memberId).eq("company_id", me.company_id).select("rule_id").single();
  if (error) return { error: error.message };
  await resetTurns(sb, data.rule_id, me.company_id);
  await audit(me.company_id, me.id, active ? "routing.user_on" : "routing.user_off", data.rule_id, { member_id: memberId });
  revalidatePath(PATH);
  return { ok: active ? "User on." : "User off." };
}

export async function deleteRouteMember(memberId: string): Promise<Res> {
  const { me, sb } = await ctx();
  if (!id.safeParse(memberId).success) return { error: "Invalid user." };
  const { data, error } = await sb.from("lb_route_members").delete().eq("id", memberId).eq("company_id", me.company_id).select("rule_id").single();
  if (error) return { error: error.message };
  await resetTurns(sb, data.rule_id, me.company_id);
  await audit(me.company_id, me.id, "routing.user_delete", data.rule_id, { member_id: memberId });
  revalidatePath(PATH);
  return { ok: "Removed." };
}

/** First-reply SLA settings: reassign + alert when a new lead gets no reply in time. */
export async function saveReplySla(input: { enabled: boolean; minutes: string; maxReassign: string; notify: boolean }): Promise<Res> {
  const { me, sb } = await ctx();
  const p = z.object({
    minutes: z.coerce.number().int().min(1, "Minutes must be 1 or more").max(1440, "Minutes can be at most 1440 (24 h)"),
    maxReassign: z.coerce.number().int().min(0, "Reassign count must be 0 or more").max(10, "Reassign count can be at most 10"),
  }).safeParse({ minutes: input.minutes, maxReassign: input.maxReassign });
  if (!p.success) return { error: p.error.issues[0].message };
  const { error } = await sb.rpc("lb_save_reply_sla", {
    p_enabled: !!input.enabled, p_minutes: p.data.minutes, p_max_reassign: p.data.maxReassign, p_notify: !!input.notify,
  });
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "routing.reply_sla", null, { ...p.data, enabled: !!input.enabled, notify: !!input.notify });
  revalidatePath(PATH);
  return { ok: input.enabled ? `SLA on: new leads with no reply in ${p.data.minutes} min will be handled.` : "SLA off." };
}
