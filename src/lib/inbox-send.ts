import { after } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient, hasServiceRole } from "@/lib/supabase/server";
import { drainOutbox } from "@/lib/outbox";
import { errMsg } from "@/lib/util";
import { rateLimit } from "@/lib/actions/auth";

// Shared by the inbox and the documents library. Not a server-action module: nothing here is callable from the browser.

type Result = { error?: string; ok?: boolean; data?: unknown };
const MB = 1024 * 1024;
// Largest attachment an agent can send. WhatsApp accepts documents up to 100 MB; the storage
// project's global file-size limit can be lower (Supabase Free = 50 MB), so it is an env setting.
export const MAX_MB = Math.min(100, Math.max(1, Number(process.env.MEDIA_MAX_MB) || 50));

/**
 * WhatsApp type for an attachment. Meta caps images at 5 MB and video/audio at 16 MB; anything
 * bigger (or an unsupported format) still goes through as a document, which allows up to 100 MB.
 */
export function mediaKind(mime: string, size: number): "image" | "video" | "audio" | "document" {
  if (/^image\/(jpeg|png)$/.test(mime) && size <= 5 * MB) return "image";
  if (/^video\/(mp4|3gpp)$/.test(mime) && size <= 16 * MB) return "video";
  if (/^audio\/(aac|amr|mpeg|mp4|ogg)$/.test(mime) && size <= 16 * MB) return "audio";
  return "document";
}

export function kick() {
  after(() => drainOutbox(15000).catch((e) => console.error("drain failed:", e?.message)));
}

export async function enqueue(convId: string, clientId: string, p: Record<string, unknown>): Promise<Result> {
  const { profile } = await requireProfile();
  if (!(await rateLimit(`send:${profile.id}`, 60, 60))) return { error: "Sending too fast — wait a moment." };
  const { data, error } = await (await createClient()).rpc("lb_enqueue_message", { p_conv: convId, p_client_id: clientId, p });
  if (error) return { error: errMsg(error) };
  if (!hasServiceRole()) return { ok: true, data, error: "Saved, but sending is disabled until the server is configured (service role key)." };
  kick();
  return { ok: true, data };
}

