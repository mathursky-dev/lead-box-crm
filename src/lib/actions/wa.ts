"use server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, requireProfile, can } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import { DEFAULT_PREFS, insideHours, keywordHit, pickBot, splitKeywords, type WaBot, type WaPrefs } from "@/lib/wa";
import { sendTemplate, sendText } from "./inbox";

type FormState = { error?: string; ok?: string } | undefined;

async function audit(companyId: string, actorId: string, action: string, entity: string, entityId: string, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity, entity_id: entityId, data }).then(() => {}, () => {});
}

// ---------------------------------------------------------- chatbots
const botSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
  name: z.string().trim().min(1, "Name is required").max(80),
  keywords: z.string().trim().min(1, "Add at least one keyword").max(1000),
  match_type: z.enum(["exact", "contains", "starts"]),
  reply: z.string().trim().min(1, "Reply is required").max(4096),
  hours_rule: z.enum(["always", "inside", "outside"]),
  number_id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
  priority: z.coerce.number().int().min(1).max(9999),
});

export async function saveBot(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = botSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, keywords, ...v } = p.data;
  const row = { ...v, keywords: keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 50), is_active: form.get("is_active") !== null ? form.get("is_active") === "on" : true, updated_at: new Date().toISOString() };
  const sb = await createClient();
  const { error } = id
    ? await sb.from("lb_wa_bots").update(row).eq("id", id)
    : await sb.from("lb_wa_bots").insert({ ...row, company_id: me.company_id, created_by: me.id });
  if (error) return { error: errMsg(error) };
  await audit(me.company_id, me.id, id ? "wa_bot.update" : "wa_bot.create", "wa_bot", id ?? v.name, { name: v.name });
  revalidatePath("/whatsapp/chatbots");
  return { ok: id ? "Bot saved." : "Bot created." };
}

export async function toggleBot(id: string, active: boolean): Promise<FormState> {
  await requireAdmin();
  const { error } = await (await createClient()).from("lb_wa_bots").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: errMsg(error) };
  revalidatePath("/whatsapp/chatbots");
  return { ok: active ? "Bot on." : "Bot off." };
}

export async function deleteBot(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const { error } = await (await createClient()).from("lb_wa_bots").delete().eq("id", id);
  if (error) return { error: errMsg(error) };
  await audit(me.company_id, me.id, "wa_bot.delete", "wa_bot", id);
  revalidatePath("/whatsapp/chatbots");
  return { ok: "Deleted." };
}

/** Dry run: what would happen if a customer sent this text right now? Sends nothing. */
export async function testBotMessage(text: string): Promise<{ result: string; reply?: string }> {
  await requireProfile();
  const sb = await createClient();
  const [{ data: bots }, { data: pr }] = await Promise.all([
    sb.from("lb_wa_bots").select("*").order("priority"),
    sb.from("lb_wa_prefs").select("*").maybeSingle(),
  ]);
  const prefs: WaPrefs = { ...DEFAULT_PREFS, ...(pr ?? {}) };
  if (prefs.hours_from.length > 5) prefs.hours_from = prefs.hours_from.slice(0, 5);
  if (prefs.hours_to.length > 5) prefs.hours_to = prefs.hours_to.slice(0, 5);
  if (prefs.optout_enabled) {
    const o = keywordHit(text, splitKeywords(prefs.optout_keywords));
    if (o) return { result: `Opt-out keyword “${o}” — contact is marked opted-out.`, reply: prefs.optout_reply ?? undefined };
    const i = keywordHit(text, splitKeywords(prefs.optin_keywords));
    if (i) return { result: `Opt-in keyword “${i}” — contact is subscribed again.`, reply: prefs.optin_reply ?? undefined };
  }
  const inside = insideHours(prefs);
  const hit = pickBot((bots ?? []) as WaBot[], text, { insideHours: inside });
  if (hit) return { result: `Bot “${hit.bot.name}” answers (keyword “${hit.keyword}”).`, reply: hit.bot.reply };
  if (prefs.hours_enabled && !inside && prefs.away_message) return { result: "No bot matched. Outside business hours, so the away message goes out.", reply: prefs.away_message };
  return { result: "No bot matched — this lands in Unmatched questions and waits for an agent." };
}

// ---------------------------------------------------------- preferences
export async function savePrefs(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const time = /^\d{2}:\d{2}$/;
  if (!time.test(s("hours_from")) || !time.test(s("hours_to"))) return { error: "Business hours need a valid from/to time." };
  const tz = s("timezone") || "Asia/Kolkata";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { return { error: `Unknown timezone “${tz}”.` }; }
  const row = {
    company_id: me.company_id,
    pause_bots_when_assigned: form.get("pause_bots_when_assigned") === "on",
    optout_enabled: form.get("optout_enabled") === "on",
    optout_keywords: s("optout_keywords").slice(0, 1000) || DEFAULT_PREFS.optout_keywords,
    optin_keywords: s("optin_keywords").slice(0, 1000) || DEFAULT_PREFS.optin_keywords,
    optout_reply: s("optout_reply").slice(0, 1000) || null,
    optin_reply: s("optin_reply").slice(0, 1000) || null,
    hours_enabled: form.get("hours_enabled") === "on",
    hours_from: s("hours_from"), hours_to: s("hours_to"),
    hours_days: form.getAll("hours_days").map(Number).filter((d) => d >= 0 && d <= 6),
    timezone: tz,
    away_message: s("away_message").slice(0, 1000) || null,
    updated_by: me.id, updated_at: new Date().toISOString(),
  };
  const sb = await createClient();
  const { error } = await sb.from("lb_wa_prefs").upsert(row);
  if (error) return { error: errMsg(error) };
  const cc = s("default_country").toUpperCase();
  if (cc && /^[A-Z]{2}$/.test(cc)) await sb.from("lb_companies").update({ default_country: cc }).eq("id", me.company_id);
  await audit(me.company_id, me.id, "wa_prefs.update", "company", me.company_id);
  revalidatePath("/whatsapp/settings");
  return { ok: "Preferences saved." };
}

// ---------------------------------------------------------- agents
export async function saveAgent(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: z.uuid(), availability: z.enum(["available", "away", "offline"]),
    allocation_limit: z.union([z.coerce.number().int().min(1).max(500), z.literal("")]).transform((v) => (v === "" ? null : v)),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const db = createAdminClient();
  const { data: u } = await db.from("lb_profiles").select("company_id").eq("id", p.data.id).single();
  if (!u || (u.company_id !== me.company_id && me.role !== "super_admin")) return { error: "User not found" };
  const { error } = await db.from("lb_profiles").update({
    availability: p.data.availability, allocation_limit: p.data.allocation_limit,
    accepts_auto_allocation: form.get("accepts_auto_allocation") === "on", updated_at: new Date().toISOString(),
  }).eq("id", p.data.id);
  if (error) return { error: errMsg(error) };
  await audit(me.company_id, me.id, "agent.update", "profile", p.data.id, p.data);
  revalidatePath("/whatsapp/settings");
  return { ok: "Saved." };
}

// ---------------------------------------------------------- send
/** Single send to any phone: finds/creates the contact + lead, opens the chat, queues the message. */
export async function quickSend(_: FormState, form: FormData): Promise<FormState> {
  const { profile } = await requireProfile();
  if (!can(profile, "chats.send")) return { error: "You do not have permission to send WhatsApp messages." };
  const numberId = z.uuid().safeParse(form.get("number_id"));
  if (!numberId.success) return { error: "Pick a business number." };
  const sb = await createClient();
  const { data: co } = await sb.from("lb_companies").select("default_country").eq("id", profile.company_id).maybeSingle();
  const phone = normalizePhone(String(form.get("phone") ?? ""), co?.default_country || "IN");
  if (!phone) return { error: "Enter a valid phone number (with country code, or a local number)." };
  const mode = String(form.get("mode") ?? "template");

  let leadId: string | null = null;
  const { data: cust } = await sb.from("lb_customers").select("id").eq("phone_e164", phone).maybeSingle();
  if (cust) leadId = (await sb.from("lb_leads").select("id").eq("customer_id", cust.id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data?.id ?? null;
  if (!leadId) {
    const name = String(form.get("name") ?? "").trim();
    const { data, error } = await sb.rpc("lb_create_lead", { p: { phone_e164: phone, name } });
    if (error) return { error: errMsg(error) };
    leadId = (data as { lead_id: string }).lead_id;
  }
  const { data: conv, error: cErr } = await sb.rpc("lb_start_conversation", { p_lead: leadId, p_number: numberId.data });
  if (cErr) return { error: errMsg(cErr) };

  const r = mode === "text"
    ? await sendText(conv as string, randomUUID(), String(form.get("body") ?? ""))
    : await (async () => {
        const [name, language] = String(form.get("template") ?? "").split("|");
        if (!name || !language) return { error: "Pick an approved template." };
        const params = form.getAll("param").map(String);
        if (params.some((x) => !x.trim())) return { error: "Fill every template variable." };
        return sendTemplate(conv as string, randomUUID(), name, language, params);
      })();
  if (r.error && !r.ok) return { error: r.error };
  revalidatePath("/whatsapp");
  return { ok: r.error ?? `Queued to ${phone}. Track it in Live chat.` };
}
