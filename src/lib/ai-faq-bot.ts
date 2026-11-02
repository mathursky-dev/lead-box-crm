import "server-only";
import { createAdminClient } from "./supabase/server";
import { aiConfigured, answerFaq, pickFaqs, AiError, type FaqItem } from "./ai";
import { companyAiAllowed } from "./ai-gate";
import { insideHours, type WaPrefs } from "./wa";
import { DEFAULT_AI_BOT, type AiBotSettings } from "./ai-faq-bot-shared";

type Db = ReturnType<typeof createAdminClient>;
type Inbound = { messageId: string; conversationId: string; companyId: string; body: string | null };
type Conv = { id: string; number_id: string; customer_id: string; assignee_id: string | null };

export type AiFaqOutcome =
  | { kind: "answer"; reply: string; reason: string }
  | { kind: "handover"; message: string; reason: string }
  | null; // bot not in play: the normal unmatched / away handling continues

export async function loadAiBot(db: Db, companyId: string): Promise<AiBotSettings | null> {
  const { data, error } = await db.from("lb_ai_bot_settings").select("*").eq("company_id", companyId).maybeSingle();
  if (error || !data) return null; // SQL not applied yet, or never set up
  return { ...DEFAULT_AI_BOT, ...data };
}

/** Last messages of the chat, oldest first; voice notes count with their transcript. */
async function chatHistory(db: Db, convId: string) {
  const { data } = await db.from("lb_messages").select("direction,body,type,created_at,transcript").eq("conversation_id", convId)
    .order("created_at", { ascending: false }).limit(16);
  return ((data ?? []) as { direction: "in" | "out"; body: string | null; type: string; created_at: string; transcript?: string | null }[])
    .reverse().map((m) => ({ ...m, body: m.body ?? (m.transcript ? `🎤 (voice note) ${m.transcript}` : null) }));
}

/** Everything the bot may answer from: FAQs, price list, optionally store products and approved knowledge. */
export async function loadFaqData(db: Db, companyId: string, s: Pick<AiBotSettings, "use_knowledge" | "use_products">) {
  const [{ data: faqs }, kb, products] = await Promise.all([
    db.from("lb_ai_faqs").select("id,kind,question,answer,price,unit,category").eq("company_id", companyId).eq("is_active", true).order("kind").order("sort").limit(2000),
    s.use_knowledge ? db.from("lb_knowledge").select("id,title,content").eq("company_id", companyId).eq("status", "approved").limit(200) : Promise.resolve({ data: [] }),
    s.use_products ? db.from("lb_products").select("id,name,price,unit,category,description").eq("company_id", companyId).eq("is_active", true).limit(500) : Promise.resolve({ data: [] }),
  ]);
  const items: FaqItem[] = [
    ...((faqs ?? []) as FaqItem[]),
    ...((products.data ?? []) as { id: string; name: string; price: number | null; unit: string | null; category: string | null; description: string | null }[])
      .map((p) => ({ id: `p-${p.id}`, kind: "price" as const, question: p.name, answer: (p.description ?? "").slice(0, 300), price: p.price, unit: p.unit, category: p.category })),
  ];
  return { items, knowledge: (kb.data ?? []) as { id: string; title: string; content: string }[], faqIds: new Set((faqs ?? []).map((f) => f.id as string)) };
}

/**
 * Called by the auto-reply runner when no flow and no keyword bot answered.
 * Decides whether the AI FAQ bot answers, hands the chat to a human, or stays out.
 */
export async function runAiFaqBot(db: Db, ev: Inbound, conv: Conv, prefs: WaPrefs, business: string): Promise<AiFaqOutcome> {
  if (!ev.body?.trim() || !aiConfigured()) return null;
  const s = await loadAiBot(db, ev.companyId);
  if (!s?.enabled) return null;
  if (s.number_id && s.number_id !== conv.number_id) return null;
  const inside = insideHours(prefs);
  if ((s.hours_rule === "outside" && inside) || (s.hours_rule === "inside" && !inside)) return null;
  if (!(await companyAiAllowed(db, ev.companyId))) return null;

  // Webhook replay: this message was already handled by the AI bot.
  const { count: done } = await db.from("lb_wa_bot_events").select("id", { count: "exact", head: true })
    .eq("inbound_message_id", ev.messageId).in("kind", ["ai_reply", "ai_handover"]);
  if (done) return null;

  // Already handed to a human: stay quiet for the pause window.
  const { data: c } = await db.from("lb_conversations").select("ai_handover_at").eq("id", conv.id).maybeSingle();
  if (c?.ai_handover_at && Date.now() - new Date(c.ai_handover_at).getTime() < s.handover_pause_hours * 3600000) return null;

  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const [{ count: today }, { count: inChat }] = await Promise.all([
    db.from("lb_wa_bot_events").select("id", { count: "exact", head: true }).eq("company_id", ev.companyId).eq("kind", "ai_reply").gte("created_at", dayAgo),
    db.from("lb_wa_bot_events").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("kind", "ai_reply").gte("created_at", dayAgo),
  ]);
  if ((today ?? 0) >= s.daily_limit) return null;
  if ((inChat ?? 0) >= s.max_replies_per_chat) return { kind: "handover", message: s.handover_message, reason: "Reply limit for this chat reached" };

  const data = await loadFaqData(db, ev.companyId, s);
  if (!data.items.length && !data.knowledge.length) return null; // nothing to answer from yet

  const [messages, { data: cu }] = await Promise.all([
    chatHistory(db, conv.id),
    db.from("lb_customers").select("name,wa_profile_name").eq("id", conv.customer_id).maybeSingle(),
  ]);
  if (!messages.length) return null;
  try {
    const d = await answerFaq({
      business, botName: s.bot_name, items: pickFaqs(data.items, messages), knowledge: data.knowledge.slice(0, 40),
      instructions: s.instructions, customer: cu?.name || cu?.wa_profile_name || "Customer", messages, outsideHours: !inside,
    });
    const hits = d.used_ids.filter((id) => data.faqIds.has(id));
    if (hits.length) await db.rpc("lb_ai_faq_hits", { p_ids: hits });
    return d.action === "answer" ? { kind: "answer", reply: d.reply, reason: d.reason } : { kind: "handover", message: s.handover_message, reason: d.reason || "Not in FAQs" };
  } catch (e) {
    console.error("ai faq bot:", e instanceof AiError ? e.message : (e as Error).message);
    return null; // AI down: behave as if the bot were off (unmatched + away message)
  }
}

/** Mark the chat as handed over, assign it if nobody owns it, and tell the owner. */
export async function applyHandover(db: Db, ev: Inbound, conv: Conv, reason: string) {
  const s = await loadAiBot(db, ev.companyId);
  const assignee = conv.assignee_id ?? s?.handover_assign_to ?? null;
  const now = new Date().toISOString();
  await db.from("lb_conversations").update({
    ai_handover_at: now, ai_handover_reason: reason.slice(0, 200), status: "open", updated_at: now,
    ...(!conv.assignee_id && assignee ? { assignee_id: assignee } : {}),
  }).eq("id", conv.id);
  if (assignee) {
    const { data: cu } = await db.from("lb_customers").select("name,wa_profile_name,phone_e164").eq("id", conv.customer_id).maybeSingle();
    await db.from("lb_notifications").insert({
      company_id: ev.companyId, user_id: assignee, type: "message",
      title: `AI bot handed a chat to you · ${cu?.name || cu?.wa_profile_name || cu?.phone_e164 || "customer"}`,
      body: `${reason}${ev.body ? ` — “${ev.body.slice(0, 160)}”` : ""}`, link: `/inbox?c=${conv.id}`, dedupe_key: `ai-handover:${ev.messageId}`,
    }).then(() => {}, () => {});
  }
}

/** Dry run for the settings page: what would the bot say to this message? Sends nothing. */
export async function testAiFaq(db: Db, companyId: string, business: string, text: string) {
  const s = (await loadAiBot(db, companyId)) ?? DEFAULT_AI_BOT;
  const data = await loadFaqData(db, companyId, s);
  if (!data.items.length && !data.knowledge.length) return { error: "Add some FAQs or price list items first." };
  const messages = [{ direction: "in" as const, body: text, type: "text", created_at: new Date().toISOString() }];
  const d = await answerFaq({ business, botName: s.bot_name, items: pickFaqs(data.items, messages), knowledge: data.knowledge.slice(0, 40), instructions: s.instructions, customer: "Customer", messages, outsideHours: false });
  const names = new Map([...data.items.map((i) => [i.id, i.question] as const), ...data.knowledge.map((k) => [k.id, k.title] as const)]);
  return { action: d.action, reply: d.action === "answer" ? d.reply : s.handover_message, reason: d.reason, used: d.used_ids.map((id) => names.get(id) ?? id) };
}
