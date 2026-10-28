import "server-only";
import { createAdminClient } from "./supabase/server";
import { downloadMedia, numberCredentials } from "./whatsapp";
import { runAutoReplies } from "./wa-bots";

type WaMessage = {
  id: string; from: string; timestamp: string; type: string;
  text?: { body: string }; button?: { text: string; payload?: string };
  interactive?: { button_reply?: { id?: string; title: string }; list_reply?: { id?: string; title: string } };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  image?: Media; video?: Media; audio?: Media; document?: Media & { filename?: string }; sticker?: Media;
  contacts?: { name?: { formatted_name?: string } }[];
  context?: { id?: string }; reaction?: { emoji?: string; message_id?: string };
};
type Media = { id: string; mime_type?: string; caption?: string };
type WaStatus = { id: string; status: string; timestamp: string; errors?: { code: number; title?: string; message?: string; error_data?: { details?: string } }[] };
type Change = { field: string; value: { metadata?: { phone_number_id: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[]; statuses?: WaStatus[] } };

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"] as const;

function bodyOf(m: WaMessage): string | null {
  if (m.text) return m.text.body;
  if (m.button) return m.button.text;
  if (m.interactive) return m.interactive.button_reply?.title ?? m.interactive.list_reply?.title ?? null;
  if (m.reaction) return m.reaction.emoji ? `Reacted ${m.reaction.emoji}` : "Removed reaction";
  if (m.location) return `📍 ${[m.location.name, m.location.address].filter(Boolean).join(", ")} (${m.location.latitude}, ${m.location.longitude})`;
  if (m.contacts) return `Shared contact: ${m.contacts.map((c) => c.name?.formatted_name).filter(Boolean).join(", ")}`;
  for (const t of MEDIA_TYPES) { const x = m[t] as Media | undefined; if (x) return x.caption ?? null; }
  return m.type === "unsupported" ? "[Unsupported message type]" : null;
}

/** Process one stored webhook delivery. Idempotent: replays are no-ops. */
export async function processWebhookEvent(eventId: string) {
  const db = createAdminClient();
  const { data: ev } = await db.from("lb_webhook_events").select("id,payload,processed_at,attempts").eq("id", eventId).single();
  if (!ev || ev.processed_at) return;
  try {
    const mediaJobs: { messageId: string; conversationId: string; companyId: string; numberId: string; mediaId: string; filename?: string }[] = [];
    const botJobs: Parameters<typeof runAutoReplies>[0][] = [];
    for (const entry of (ev.payload?.entry ?? []) as { changes?: Change[] }[]) {
      for (const change of entry.changes ?? []) {
        if (change.field === "message_template_status_update") {
          const t = change.value as unknown as { event?: string; message_template_id?: number | string };
          if (t.message_template_id && t.event) {
            const { error } = await db.from("lb_wa_templates").update({ status: t.event, synced_at: new Date().toISOString() }).eq("wa_template_id", String(t.message_template_id));
            if (error) throw new Error(`template status: ${error.message}`);
          }
          continue;
        }
        if (change.field !== "messages") continue;
        const v = change.value;
        const pnid = v.metadata?.phone_number_id;
        for (const m of v.messages ?? []) {
          if (m.type === "reaction" && m.reaction?.message_id) {
            const { error } = await db.rpc("lb__apply_reaction", { p_target_wamid: m.reaction.message_id, p_emoji: m.reaction.emoji ?? "" });
            if (error) throw new Error(`reaction: ${error.message}`);
            continue;
          }
          const media = MEDIA_TYPES.map((t) => m[t] as (Media & { filename?: string }) | undefined).find(Boolean);
          const contact = v.contacts?.find((c) => c.wa_id === m.from) ?? v.contacts?.[0];
          const { data, error } = await db.rpc("lb_ingest_inbound", {
            p: {
              phone_number_id: pnid, from: m.from, profile_name: contact?.profile?.name, wa_message_id: m.id, timestamp: m.timestamp,
              type: m.type, body: bodyOf(m), media_id: media?.id, mime_type: media?.mime_type, filename: media?.filename,
            },
          });
          if (error) throw new Error(`ingest: ${error.message}`);
          if (data?.message_id) botJobs.push({ messageId: data.message_id, conversationId: data.conversation_id, companyId: data.company_id, body: bodyOf(m), type: m.type,
            replyId: m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.button?.payload ?? null });
          if (data?.message_id && m.context?.id) {
            const r = await db.rpc("lb__link_reply", { p_msg: data.message_id, p_context_wamid: m.context.id });
            if (r.error) throw new Error(`reply link: ${r.error.message}`);
          }
          if (data?.message_id && media?.id) {
            const { data: num } = await db.from("lb_wa_numbers").select("id").eq("phone_number_id", pnid!).single();
            mediaJobs.push({ messageId: data.message_id, conversationId: data.conversation_id, companyId: data.company_id, numberId: num!.id, mediaId: media.id, filename: media.filename });
          }
        }
        for (const s of v.statuses ?? []) {
          const err = s.errors?.[0];
          const { error } = await db.rpc("lb_apply_status", {
            p_wamid: s.id, p_status: s.status, p_ts: new Date(Number(s.timestamp) * 1000).toISOString(),
            p_code: err ? String(err.code) : null, p_msg: err ? [err.title ?? err.message, err.error_data?.details].filter(Boolean).join(" — ") : null,
          });
          if (error) throw new Error(`status: ${error.message}`);
        }
      }
    }
    await db.from("lb_webhook_events").update({ processed_at: new Date().toISOString(), error: null, attempts: ev.attempts + 1 }).eq("id", ev.id);
    for (const j of mediaJobs) await storeInboundMedia(j);
    for (const j of botJobs) await runAutoReplies(j);
  } catch (e) {
    await db.from("lb_webhook_events").update({ attempts: ev.attempts + 1, error: (e as Error).message.slice(0, 500) }).eq("id", ev.id);
    throw e;
  }
}

/** Copy inbound media into private storage; on failure the message keeps media_status 'pending' for retry. */
export async function storeInboundMedia(j: { messageId: string; conversationId: string; companyId: string; numberId: string; mediaId: string; filename?: string }) {
  const db = createAdminClient();
  try {
    const c = await numberCredentials(j.numberId);
    if (!c) throw new Error("No credentials");
    const r = await downloadMedia(c.token, j.mediaId);
    if (!r.ok) throw new Error(r.message);
    const ext = (j.filename?.split(".").pop() ?? r.data.mime.split("/")[1]?.split(";")[0] ?? "bin").replace(/[^\w]/g, "").slice(0, 8);
    const path = `${j.companyId}/${j.conversationId}/${j.messageId}.${ext}`;
    const up = await db.storage.from("lb-media").upload(path, r.data.bytes, { contentType: r.data.mime, upsert: true });
    if (up.error) throw new Error(up.error.message);
    await db.from("lb_messages").update({ media_path: path, media_mime: r.data.mime, media_status: "stored" }).eq("id", j.messageId);
  } catch (e) {
    await db.from("lb_messages").update({ media_status: "failed", error_message: `Media: ${(e as Error).message}`.slice(0, 300) }).eq("id", j.messageId);
  }
}

/** Retry deliveries that failed or were interrupted. */
export async function reprocessPendingWebhooks(limit = 25) {
  const db = createAdminClient();
  const { data } = await db.from("lb_webhook_events").select("id").is("processed_at", null).lt("attempts", 10)
    .lt("received_at", new Date(Date.now() - 60000).toISOString()).order("received_at").limit(limit);
  let ok = 0;
  for (const e of data ?? []) { try { await processWebhookEvent(e.id); ok++; } catch { /* recorded on the row */ } }
  // Inbound media whose download failed earlier.
  const { data: media } = await db.from("lb_messages").select("id,conversation_id,company_id,media_wa_id,media_filename,conversation:lb_conversations(number_id)")
    .eq("direction", "in").eq("media_status", "failed").not("media_wa_id", "is", null).gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString()).limit(10);
  for (const m of media ?? []) {
    await storeInboundMedia({ messageId: m.id, conversationId: m.conversation_id, companyId: m.company_id, mediaId: m.media_wa_id!, filename: m.media_filename ?? undefined,
      numberId: (m.conversation as unknown as { number_id: string }).number_id });
  }
  return ok;
}
