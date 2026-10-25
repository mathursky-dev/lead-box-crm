"use server";
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { drainOutbox } from "@/lib/outbox";
import { graph, numberCredentials } from "@/lib/whatsapp";
import { errMsg } from "@/lib/util";
import { rateLimit } from "./auth";

type Result = { error?: string; ok?: boolean; data?: unknown };

const MAX_BYTES = 16 * 1024 * 1024; // WhatsApp limit for video/audio; images 5MB, documents 100MB (we cap at 16MB)
const KIND: [RegExp, string][] = [[/^image\/(jpeg|png)$/, "image"], [/^video\/(mp4|3gpp)$/, "video"], [/^audio\//, "audio"]];

function kick() {
  after(() => drainOutbox(15000).catch((e) => console.error("drain failed:", e?.message)));
}

async function enqueue(convId: string, clientId: string, p: Record<string, unknown>): Promise<Result> {
  const { profile } = await requireProfile();
  if (!(await rateLimit(`send:${profile.id}`, 60, 60))) return { error: "Sending too fast — wait a moment." };
  const { data, error } = await (await createClient()).rpc("lb_enqueue_message", { p_conv: convId, p_client_id: clientId, p });
  if (error) return { error: errMsg(error) };
  if (!hasServiceRole()) return { ok: true, data, error: "Saved, but sending is disabled until the server is configured (service role key)." };
  kick();
  return { ok: true, data };
}

export async function sendText(convId: string, clientId: string, body: string, replyTo?: string): Promise<Result> {
  const text = body.trim();
  if (!text) return { error: "Message is empty" };
  if (text.length > 4096) return { error: "Message is too long (max 4096 characters)" };
  return enqueue(convId, clientId, { type: "text", body: text, reply_to: replyTo ?? null });
}

export async function sendTemplate(convId: string, clientId: string, name: string, language: string, params: string[]): Promise<Result> {
  return enqueue(convId, clientId, { type: "template", template_name: name, template_language: language, template_params: params.map((p) => p.slice(0, 1000)) });
}

export async function sendFile(form: FormData): Promise<Result> {
  const { profile } = await requireProfile();
  const convId = z.uuid().safeParse(form.get("conversation_id"));
  const clientId = z.uuid().safeParse(form.get("client_id"));
  const file = form.get("file");
  if (!convId.success || !clientId.success || !(file instanceof File)) return { error: "Invalid upload" };
  if (file.size === 0 || file.size > MAX_BYTES) return { error: "File must be between 1 byte and 16 MB" };
  if (!hasServiceRole()) return { error: "Uploads need the server to be configured (service role key)." };
  // Visibility check with the user's own RLS before writing with the service role.
  const { data: conv } = await (await createClient()).from("lb_conversations").select("id,company_id").eq("id", convId.data).maybeSingle();
  if (!conv) return { error: "Conversation not found" };
  const type = KIND.find(([re]) => re.test(file.type))?.[1] ?? "document";
  if (type === "image" && file.size > 5 * 1024 * 1024) return { error: "Images must be 5 MB or smaller" };
  const safeName = file.name.replace(/[^\w.\- ]/g, "_").slice(-80) || "file";
  const path = `${conv.company_id}/${conv.id}/${randomUUID()}-${safeName}`;
  const up = await createAdminClient().storage.from("lb-media").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream" });
  if (up.error) return { error: `Upload failed: ${up.error.message}` };
  void profile;
  return enqueue(convId.data, clientId.data, {
    type, media_path: path, media_mime: file.type, media_filename: safeName, body: String(form.get("caption") ?? "").trim() || null,
    reply_to: z.uuid().safeParse(form.get("reply_to")).data ?? null,
  });
}

const EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏", ""];

/** React to a message (empty emoji removes the reaction). Sent directly: reactions are idempotent, so no outbox row. */
export async function sendReaction(messageId: string, emoji: string): Promise<Result> {
  const { profile } = await requireProfile();
  if (!EMOJI.includes(emoji)) return { error: "Unsupported reaction" };
  if (!hasServiceRole()) return { error: "Sending needs the server to be configured (service role key)." };
  if (!(await rateLimit(`react:${profile.id}`, 60, 60))) return { error: "Too many reactions — wait a moment." };
  const { data: t, error } = await (await createClient()).rpc("lb_reaction_target", { p_msg: messageId });
  if (error) return { error: errMsg(error) };
  const c = await numberCredentials(t.number_id);
  if (!c?.is_active) return { error: "Business number is disconnected or has no access token." };
  const r = await graph(c.token, `${c.endpoint}/messages`, { method: "POST", body: JSON.stringify({
    messaging_product: "whatsapp", recipient_type: "individual", to: String(t.to).replace(/^\+/, ""), type: "reaction", reaction: { message_id: t.wamid, emoji } }) });
  if (!r.ok) return { error: r.message };
  await createAdminClient().from("lb_messages").update({ agent_reaction: emoji || null }).eq("id", messageId);
  return { ok: true };
}

export async function retryMessage(messageId: string): Promise<Result> {
  await requireProfile();
  const { error } = await (await createClient()).rpc("lb_retry_message", { p_msg: messageId });
  if (error) return { error: errMsg(error) };
  if (hasServiceRole()) kick();
  return { ok: true };
}

export async function conversationAction(convId: string, action: string, payload: Record<string, unknown> = {}): Promise<Result> {
  await requireProfile();
  if (!["read", "status", "note", "transfer", "create_lead", "tags"].includes(action)) return { error: "Invalid action" };
  const { data, error } = await (await createClient()).rpc("lb_conversation_action", { p_conv: convId, p_action: action, p: payload });
  if (error) return { error: errMsg(error) };
  return { ok: true, data };
}
