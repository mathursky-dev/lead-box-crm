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

const MB = 1024 * 1024;
// Largest attachment an agent can send. WhatsApp accepts documents up to 100 MB; the storage
// project's global file-size limit can be lower (Supabase Free = 50 MB), so it is an env setting.
const MAX_MB = Math.min(100, Math.max(1, Number(process.env.MEDIA_MAX_MB) || 50));

/**
 * WhatsApp type for an attachment. Meta caps images at 5 MB and video/audio at 16 MB; anything
 * bigger (or an unsupported format) still goes through as a document, which allows up to 100 MB.
 */
function mediaKind(mime: string, size: number): "image" | "video" | "audio" | "document" {
  if (/^image\/(jpeg|png)$/.test(mime) && size <= 5 * MB) return "image";
  if (/^video\/(mp4|3gpp)$/.test(mime) && size <= 16 * MB) return "video";
  if (/^audio\/(aac|amr|mpeg|mp4|ogg)$/.test(mime) && size <= 16 * MB) return "audio";
  return "document";
}

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

/**
 * Step 1 of sending a file: check the chat and size, then hand the browser a one-time signed
 * upload URL so the file goes straight to storage (server functions cap request bodies at ~4.5 MB).
 */
export async function startUpload(convId: string, name: string, size: number): Promise<{ error?: string; path?: string; token?: string; maxMb?: number }> {
  await requireProfile();
  if (!z.uuid().safeParse(convId).success || !Number.isFinite(size)) return { error: "Invalid upload" };
  if (size <= 0) return { error: "File is empty" };
  if (size > MAX_MB * MB) return { error: `File is too big. The limit is ${MAX_MB} MB.`, maxMb: MAX_MB };
  if (!hasServiceRole()) return { error: "Uploads need the server to be configured (service role key)." };
  // Visibility check with the user's own RLS before signing with the service role.
  const { data: conv } = await (await createClient()).from("lb_conversations").select("id,company_id").eq("id", convId).maybeSingle();
  if (!conv) return { error: "Conversation not found" };
  const safeName = String(name).replace(/[^\w.\- ]/g, "_").slice(-80) || "file";
  const path = `${conv.company_id}/${conv.id}/${randomUUID()}-${safeName}`;
  const { data, error } = await createAdminClient().storage.from("lb-media").createSignedUploadUrl(path);
  if (error || !data) return { error: `Upload failed: ${error?.message ?? "no upload URL"}` };
  return { path: data.path, token: data.token };
}

/** Step 2: the file is in storage; check it really belongs to this chat, then queue the WhatsApp send. */
export async function sendUploaded(form: FormData): Promise<Result> {
  await requireProfile();
  const convId = z.uuid().safeParse(form.get("conversation_id"));
  const clientId = z.uuid().safeParse(form.get("client_id"));
  const path = String(form.get("path") ?? "");
  if (!convId.success || !clientId.success || !path) return { error: "Invalid upload" };
  const { data: conv } = await (await createClient()).from("lb_conversations").select("id,company_id").eq("id", convId.data).maybeSingle();
  if (!conv) return { error: "Conversation not found" };
  if (!path.startsWith(`${conv.company_id}/${conv.id}/`) || path.includes("..")) return { error: "Invalid upload" };
  const { data: info, error } = await createAdminClient().storage.from("lb-media").info(path);
  if (error || !info) return { error: "Upload not found. Please attach the file again." };
  const size = Number(info.size ?? info.metadata?.size ?? 0);
  const mime = String(info.contentType ?? info.metadata?.mimetype ?? form.get("mime") ?? "") || "application/octet-stream";
  if (size > MAX_MB * MB) {
    await createAdminClient().storage.from("lb-media").remove([path]);
    return { error: `File is too big. The limit is ${MAX_MB} MB.` };
  }
  const type = mediaKind(mime, size);
  const filename = path.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, "");
  return enqueue(convId.data, clientId.data, {
    type, media_path: path, media_mime: mime, media_filename: filename, body: String(form.get("caption") ?? "").trim() || null,
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
