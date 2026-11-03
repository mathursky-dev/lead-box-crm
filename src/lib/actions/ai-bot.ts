"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { aiConfigured } from "@/lib/ai";
import { testAiFaq } from "@/lib/ai-faq-bot";
import { parseBulk } from "@/lib/ai-faq-bot-shared";
import { transcribeConfigured, transcribeMessage } from "@/lib/transcribe";
import { rateLimit } from "./auth";

type FormState = { error?: string; ok?: string } | undefined;
const PATH = "/whatsapp/ai-bot";
const missing = (m: string) => /lb_ai_|ai_handover|transcript|schema cache|does not exist/i.test(m) ? "AI FAQ bot database update is not applied yet (run the SQL first)." : m;

async function audit(companyId: string, actorId: string, action: string, entityId: string, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity: "ai_bot", entity_id: entityId, data }).then(() => {}, () => {});
}

const uuidOrNull = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);
const settingsSchema = z.object({
  bot_name: z.string().trim().min(1, "Bot name is required").max(60),
  hours_rule: z.enum(["always", "outside", "inside"]),
  number_id: uuidOrNull,
  handover_message: z.string().trim().min(1, "Handover message is required").max(1000),
  handover_assign_to: uuidOrNull,
  handover_pause_hours: z.coerce.number().int().min(1).max(168),
  max_replies_per_chat: z.coerce.number().int().min(1).max(100),
  daily_limit: z.coerce.number().int().min(1).max(5000),
  instructions: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export async function saveAiBotSettings(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me, features } = await requireAdmin();
  const p = settingsSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const enabled = form.get("enabled") === "on";
  if (enabled && !features.includes("ai")) return { error: "AI is not included in your plan. Upgrade from the Billing page." };
  const row = { ...p.data, enabled, use_knowledge: form.get("use_knowledge") === "on", use_products: form.get("use_products") === "on",
    company_id: me.company_id, updated_by: me.id, updated_at: new Date().toISOString() };
  const { error } = await (await createClient()).from("lb_ai_bot_settings").upsert(row, { onConflict: "company_id" });
  if (error) return { error: missing(errMsg(error)) };
  await audit(me.company_id, me.id, "ai_bot.settings", me.company_id, { enabled, hours_rule: row.hours_rule });
  revalidatePath(PATH);
  return { ok: enabled ? "Saved. AI FAQ bot is ON." : "Saved. AI FAQ bot is off." };
}

const faqSchema = z.object({
  id: uuidOrNull,
  kind: z.enum(["faq", "price"]),
  question: z.string().trim().min(1, "Question / item is required").max(500),
  answer: z.string().trim().max(4000).optional().default(""),
  price: z.union([z.literal(""), z.coerce.number().min(0).max(1e10)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  unit: z.string().trim().max(40).optional().transform((v) => v || null),
  category: z.string().trim().max(60).optional().transform((v) => v || null),
  sort: z.coerce.number().int().min(0).max(9999).optional().default(100),
});

export async function saveFaq(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = faqSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  if (v.kind === "faq" && !v.answer) return { error: "Answer is required." };
  const row = { ...v, is_active: form.get("is_active") !== null ? form.get("is_active") === "on" : true, updated_at: new Date().toISOString() };
  const sb = await createClient();
  const { error } = id
    ? await sb.from("lb_ai_faqs").update(row).eq("id", id)
    : await sb.from("lb_ai_faqs").insert({ ...row, company_id: me.company_id, created_by: me.id });
  if (error) return { error: missing(errMsg(error)) };
  revalidatePath(PATH);
  return { ok: id ? "Saved." : v.kind === "faq" ? "FAQ added." : "Price added." };
}

export async function bulkAddFaqs(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const kind = form.get("kind") === "price" ? "price" : "faq";
  const rows = parseBulk(kind, String(form.get("text") ?? "")).slice(0, 500)
    .map((r) => ({ ...r, question: r.question.slice(0, 500), answer: r.answer.slice(0, 4000), unit: r.unit?.slice(0, 40) ?? null }))
    .filter((r) => r.question && (kind === "price" || r.answer));
  if (!rows.length) return { error: kind === "faq" ? "Nothing found. Use “Q: … / A: …” blocks or one “question | answer” per line." : "Nothing found. Use one “Item | Price | Unit | Note” per line." };
  const { error } = await (await createClient()).from("lb_ai_faqs").insert(rows.map((r, i) => ({ ...r, kind, sort: 100 + i, company_id: me.company_id, created_by: me.id })));
  if (error) return { error: missing(errMsg(error)) };
  await audit(me.company_id, me.id, "ai_bot.bulk_add", kind, { count: rows.length });
  revalidatePath(PATH);
  return { ok: `${rows.length} ${kind === "faq" ? "FAQs" : "price items"} added.` };
}

export async function toggleFaq(id: string, active: boolean): Promise<FormState> {
  await requireAdmin();
  const { error } = await (await createClient()).from("lb_ai_faqs").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: errMsg(error) };
  revalidatePath(PATH);
  return { ok: active ? "On." : "Off." };
}

export async function deleteFaq(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const { error } = await (await createClient()).from("lb_ai_faqs").delete().eq("id", id);
  if (error) return { error: errMsg(error) };
  await audit(me.company_id, me.id, "ai_bot.faq_delete", id);
  revalidatePath(PATH);
  return { ok: "Deleted." };
}

export type AiTestOut = { error?: string; action?: "answer" | "handover"; reply?: string; reason?: string; used?: string[] };

/** Dry run from the settings page: nothing is sent to anyone. */
export async function testAiBot(text: string): Promise<AiTestOut> {
  const { profile, company, features } = await requireProfile();
  if (!features.includes("ai")) return { error: "AI is not included in your plan." };
  if (!aiConfigured()) return { error: "AI is not configured on the server (ANTHROPIC_API_KEY)." };
  if (!text.trim()) return { error: "Type a customer message." };
  if (!(await rateLimit(`ai-bot-test:${profile.id}`, 30, 3600))) return { error: "Test limit reached (30 per hour)." };
  try {
    return await testAiFaq(createAdminClient(), profile.company_id, (company as { name?: string }).name || "the business", text.slice(0, 1000));
  } catch (e) {
    return { error: missing((e as Error).message) };
  }
}

/** Let the AI bot answer this chat again after it handed over. */
export async function resumeAiBot(convId: string): Promise<FormState> {
  await requireProfile();
  const sb = await createClient();
  const { data: conv } = await sb.from("lb_conversations").select("id").eq("id", convId).maybeSingle(); // RLS: must see the chat
  if (!conv) return { error: "Conversation not found." };
  const { error } = await createAdminClient().from("lb_conversations").update({ ai_handover_at: null, ai_handover_reason: null }).eq("id", convId);
  if (error) return { error: missing(errMsg(error)) };
  return { ok: "AI bot will answer this chat again." };
}

/** Transcribe (or re-try) one voice note from the inbox. */
export async function transcribeVoice(messageId: string): Promise<{ error?: string; text?: string }> {
  const { profile, features } = await requireProfile();
  if (!features.includes("ai")) return { error: "Voice to text is part of the AI plan feature." };
  if (!transcribeConfigured()) return { error: "Voice to text is not set up on the server yet (GROQ_API_KEY or OPENAI_API_KEY)." };
  const sb = await createClient();
  const { data: m } = await sb.from("lb_messages").select("id,media_path,media_mime,type").eq("id", messageId).maybeSingle(); // RLS: must see the chat
  if (!m?.media_path) return { error: "Voice note not found or not downloaded yet." };
  if (!(m.media_mime ?? "").startsWith("audio/") && m.type !== "audio") return { error: "This is not a voice note." };
  if (!(await rateLimit(`transcribe:${profile.id}`, 60, 3600))) return { error: "Limit reached (60 per hour)." };
  const db = createAdminClient();
  const { data: file, error } = await db.storage.from("lb-media").download(m.media_path);
  if (error || !file) return { error: "Could not read the voice note." };
  const r = await transcribeMessage(db, m.id, await file.arrayBuffer(), m.media_mime ?? file.type);
  if (r.error) return { error: missing(r.error) };
  return { text: r.text || "" };
}
