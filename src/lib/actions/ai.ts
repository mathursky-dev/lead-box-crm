"use server";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { summarizeConversation, suggestReply, pickKnowledge, aiConfigured, AiError } from "@/lib/ai";
import { rateLimit } from "./auth";

type Out = { error?: string; text?: string; knowledge?: { id: string; title: string }[] };

async function load(convId: string) {
  const { profile, company, features } = await requireProfile();
  if (!features.includes("ai")) throw new AiError("AI is not included in your plan. Upgrade from the Billing page.", false);
  if (!can(profile, "ai.use")) throw new AiError("You do not have permission to use AI.", false);
  const sb = await createClient();
  const { data: co } = await sb.from("lb_companies").select("ai_enabled").eq("id", company.id).single();
  if (!co?.ai_enabled) throw new AiError("AI is turned off for this company (Admin → Settings).", false);
  if (!aiConfigured()) throw new AiError("AI is not configured on the server (ANTHROPIC_API_KEY).", false);
  if (!(await rateLimit(`ai:${profile.id}`, 30, 3600))) throw new AiError("AI limit reached (30 per hour).", false);
  // RLS: only conversations this user may see.
  const { data: conv } = await sb.from("lb_conversations").select("id, customer:lb_customers(name, wa_profile_name, phone_e164)").eq("id", convId).maybeSingle();
  if (!conv) throw new AiError("Conversation not found.", false);
  const { data: msgs } = await sb.from("lb_messages").select("direction,body,type,created_at").eq("conversation_id", convId)
    .order("created_at", { ascending: false }).limit(40);
  const cu = conv.customer as unknown as { name: string | null; wa_profile_name: string | null; phone_e164: string };
  return { sb, name: cu.name || cu.wa_profile_name || "Customer", messages: (msgs ?? []).reverse() as never[] };
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
    const { sb, name, messages } = await load(convId);
    if (!messages.some((m: { direction: string }) => m.direction === "in")) return { error: "The customer hasn't written anything yet." };
    const { data: kb } = await sb.from("lb_knowledge").select("id,title,content").eq("status", "approved");
    const picked = pickKnowledge(kb ?? [], messages);
    const r = await suggestReply(name, messages, picked);
    const { error } = await sb.rpc("lb_record_ai_output", { p_conv: convId, p_kind: "suggestion", p_content: r.text, p_model: r.model, p_knowledge: picked.map((a) => a.id) });
    if (error) return { error: error.message };
    return { text: r.text, knowledge: picked.map((a) => ({ id: a.id, title: a.title })) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
