"use server";
import { revalidatePath } from "next/cache";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { summarizeConversation, suggestReply, suggestReplies, scoreLead, pickKnowledge, aiConfigured, AiError } from "@/lib/ai";
import { leadFacts, recentMessages } from "@/lib/lead-score";
import { rateLimit } from "./auth";

type Out = { error?: string; text?: string; knowledge?: { id: string; title: string }[] };
export type ScoreOut = { error?: string; score?: "hot" | "warm" | "cold"; points?: number; reason?: string; next_step?: string; scored_at?: string };
export type RepliesOut = { error?: string; replies?: { label: string; text: string }[]; knowledge?: { id: string; title: string }[] };

/** Plan, permission, company switch, server key and per-user rate limit checks shared by every AI action. */
async function gate() {
  const { profile, company, features } = await requireProfile();
  if (!features.includes("ai")) throw new AiError("AI is not included in your plan. Upgrade from the Billing page.", false);
  if (!can(profile, "ai.use")) throw new AiError("You do not have permission to use AI.", false);
  const sb = await createClient();
  const { data: co } = await sb.from("lb_companies").select("ai_enabled").eq("id", company.id).single();
  if (!co?.ai_enabled) throw new AiError("AI is turned off for this company (Admin → Settings).", false);
  if (!aiConfigured()) throw new AiError("AI is not configured on the server (ANTHROPIC_API_KEY).", false);
  if (!(await rateLimit(`ai:${profile.id}`, 30, 3600))) throw new AiError("AI limit reached (30 per hour).", false);
  return { sb, business: (company as { name?: string }).name || "the business" };
}

async function load(convId: string) {
  const { sb, business } = await gate();
  // RLS: only conversations this user may see.
  const { data: conv } = await sb.from("lb_conversations").select("id, lead_id, customer:lb_customers(name, wa_profile_name, phone_e164)").eq("id", convId).maybeSingle();
  if (!conv) throw new AiError("Conversation not found.", false);
  const cu = conv.customer as unknown as { name: string | null; wa_profile_name: string | null; phone_e164: string };
  return { sb, business, leadId: conv.lead_id as string | null, name: cu.name || cu.wa_profile_name || "Customer", messages: (await recentMessages(sb, convId)) as never[] };
}

export async function aiSummary(convId: string): Promise<Out> {
  try {
    const { sb, name, messages } = await load(convId);
    if (!messages.length) return { error: "No messages to summarise yet." };
    const r = await summarizeConversation(name, messages);
    const { error } = await sb.rpc("lb_record_ai_output", { p_conv: convId, p_kind: "summary", p_content: r.text, p_model: r.model, p_knowledge: [] });
    if (error) return { error: error.message };
    return { text: r.text };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Returns a DRAFT only. The agent edits and sends it through the normal composer. */
export async function aiSuggestReply(convId: string): Promise<Out> {
  try {
    const { sb, business, name, messages } = await load(convId);
    if (!messages.some((m: { direction: string }) => m.direction === "in")) return { error: "The customer hasn't written anything yet." };
    const { data: kb } = await sb.from("lb_knowledge").select("id,title,content").eq("status", "approved");
    const picked = pickKnowledge(kb ?? [], messages);
    const r = await suggestReply(name, messages, picked, business);
    const { error } = await sb.rpc("lb_record_ai_output", { p_conv: convId, p_kind: "suggestion", p_content: r.text, p_model: r.model, p_knowledge: picked.map((a) => a.id) });
    if (error) return { error: error.message };
    return { text: r.text, knowledge: picked.map((a) => ({ id: a.id, title: a.title })) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Three ready replies (different approaches) for the composer. Still drafts: the agent picks, edits and sends. */
export async function aiSuggestReplies(convId: string): Promise<RepliesOut> {
  try {
    const { sb, business, name, messages } = await load(convId);
    if (!messages.some((m: { direction: string }) => m.direction === "in")) return { error: "The customer hasn't written anything yet." };
    const { data: kb } = await sb.from("lb_knowledge").select("id,title,content").eq("status", "approved");
    const picked = pickKnowledge(kb ?? [], messages);
    const r = await suggestReplies(name, messages, picked, business);
    const { error } = await sb.rpc("lb_record_ai_output", {
      p_conv: convId, p_kind: "suggestion", p_content: r.replies.map((x) => `[${x.label}] ${x.text}`).join("\n\n"), p_model: r.model, p_knowledge: picked.map((a) => a.id),
    });
    if (error) return { error: error.message };
    return { replies: r.replies, knowledge: picked.map((a) => ({ id: a.id, title: a.title })) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Hot / Warm / Cold rating of a lead from its latest WhatsApp chat. Saved on the lead. */
export async function aiScoreLead(leadId: string): Promise<ScoreOut> {
  try {
    const { sb } = await gate();
    const { data: lead } = await sb.from("lb_leads").select("id, customer_id, customer:lb_customers(name, wa_profile_name)").eq("id", leadId).maybeSingle();
    if (!lead) return { error: "Lead not found." };
    // Prefer the chat linked to this lead, else the customer's latest chat.
    const { data: convs } = await sb.from("lb_conversations").select("id, lead_id").eq("customer_id", lead.customer_id).order("last_message_at", { ascending: false }).limit(10);
    const conv = (convs ?? []).find((c) => c.lead_id === leadId) ?? convs?.[0];
    if (!conv) return { error: "No WhatsApp chat with this lead yet, so AI can't score it." };
    const messages = await recentMessages(sb, conv.id);
    if (!messages.length) return { error: "No WhatsApp messages with this lead yet, so AI can't score it." };
    const cu = lead.customer as unknown as { name: string | null; wa_profile_name: string | null };
    const r = await scoreLead(cu.name || cu.wa_profile_name || "Customer", messages, await leadFacts(sb, leadId));
    const { error } = await sb.rpc("lb_set_ai_score", {
      p_lead: leadId, p_conv: conv.id, p_score: r.score, p_points: r.points, p_reason: r.reason, p_next: r.next_step, p_model: r.model,
      p_upto: messages[messages.length - 1].created_at,
    });
    if (error) return { error: error.message.includes("lb_set_ai_score") ? "AI score database update is not applied yet." : error.message };
    revalidatePath(`/leads/${leadId}`);
    return { score: r.score, points: r.points, reason: r.reason, next_step: r.next_step, scored_at: new Date().toISOString() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Score the lead linked to an inbox conversation. */
export async function aiScoreConversation(convId: string): Promise<ScoreOut> {
  const sb = await createClient();
  const { data: conv } = await sb.from("lb_conversations").select("lead_id").eq("id", convId).maybeSingle();
  if (!conv?.lead_id) return { error: "Link this chat to a lead first (Create / link lead)." };
  return aiScoreLead(conv.lead_id);
}
