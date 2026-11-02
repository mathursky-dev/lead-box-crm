import "server-only";
import { createAdminClient } from "./supabase/server";
import { decryptSecret } from "./util";
import { graph } from "./whatsapp";

// Instagram DM + Facebook Messenger. Messages arrive on /api/facebook/webhook (object "page" with
// entry[].messaging, or object "instagram") and are sent with the connected Page's token.

export type SocialChannel = "messenger" | "instagram";
export const SOCIAL_SCOPES = "pages_messaging,instagram_basic,instagram_manage_messages";
export const SOCIAL_LABEL: Record<SocialChannel, string> = { messenger: "Messenger", instagram: "Instagram" };

type MessagingEvent = {
  sender?: { id: string }; recipient?: { id: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; attachments?: { type?: string; payload?: { url?: string; title?: string } }[]; reply_to?: { story?: { url?: string } } };
  postback?: { title?: string; payload?: string; mid?: string };
};
type Entry = { id: string; time?: number; messaging?: MessagingEvent[] };

export function hasMessagingEntries(payload: { object?: string; entry?: Entry[] }) {
  return payload.object === "instagram" || (payload.entry ?? []).some((e) => Array.isArray(e.messaging) && e.messaging.length > 0);
}

/** Page token by page id (null when the page is unknown). */
export async function pageToken(pageId: string) {
  const { data } = await createAdminClient().from("lb_fb_pages").select("page_token_enc").eq("page_id", pageId).maybeSingle();
  return data?.page_token_enc ? decryptSecret(data.page_token_enc) : null;
}

/** Store every message of one webhook delivery; new chats get the customer's name and picture. */
export async function processSocialWebhook(payload: { object?: string; entry?: Entry[] }) {
  const db = createAdminClient();
  const channel: SocialChannel = payload.object === "instagram" ? "instagram" : "messenger";
  for (const entry of payload.entry ?? []) {
    let pageId = entry.id;
    if (channel === "instagram") {
      const { data: pg } = await db.from("lb_fb_pages").select("page_id").eq("ig_user_id", entry.id).eq("ig_enabled", true).limit(1).maybeSingle();
      if (!pg) continue;
      pageId = pg.page_id as string;
    }
    for (const ev of entry.messaging ?? []) {
      const msg = ev.message, pb = ev.postback;
      if (!msg && !pb) continue; // reads, deliveries, reactions
      if (msg?.is_deleted) continue;
      const echo = Boolean(msg?.is_echo);
      const psid = echo ? ev.recipient?.id : ev.sender?.id;
      if (!psid || psid === entry.id) continue;
      const attachments = (msg?.attachments ?? []).map((a) => ({ type: a.type ?? "file", url: a.payload?.url ?? null, title: a.payload?.title ?? null }))
        .concat(msg?.reply_to?.story?.url ? [{ type: "story_reply", url: msg.reply_to.story.url, title: null }] : []);
      const { data, error } = await db.rpc("lb_ingest_social", {
        p: {
          channel, page_id: pageId, account_id: entry.id, psid, mid: msg?.mid ?? pb?.mid ?? null, echo,
          body: msg?.text ?? (pb ? `▶ ${pb.title ?? pb.payload ?? "Button"}` : null), attachments,
          at: new Date(ev.timestamp ?? Date.now()).toISOString(),
        },
      });
      if (error) { console.error("social ingest failed:", error.message); continue; }
      if ((data as { new_thread?: boolean })?.new_thread) await fillProfile((data as { thread_id: string }).thread_id).catch(() => null);
    }
  }
}

/** Name / username / picture of the customer (best effort). */
export async function fillProfile(threadId: string) {
  const db = createAdminClient();
  const { data: t } = await db.from("lb_social_threads").select("id,channel,page_id,psid").eq("id", threadId).maybeSingle();
  if (!t) return;
  const token = await pageToken(t.page_id as string);
  if (!token) return;
  if (t.channel === "instagram") {
    const r = await graph<{ name?: string; username?: string; profile_pic?: string }>(token, `${t.psid}?fields=name,username,profile_pic`);
    if (r.ok) await db.from("lb_social_threads").update({ name: r.data.name ?? r.data.username ?? null, username: r.data.username ?? null, profile_pic: r.data.profile_pic ?? null }).eq("id", t.id);
  } else {
    const r = await graph<{ first_name?: string; last_name?: string; name?: string; profile_pic?: string }>(token, `${t.psid}?fields=first_name,last_name,profile_pic`);
    if (r.ok) await db.from("lb_social_threads").update({ name: [r.data.first_name, r.data.last_name].filter(Boolean).join(" ") || r.data.name || null, profile_pic: r.data.profile_pic ?? null }).eq("id", t.id);
  }
}

/**
 * Send a text reply. Inside 24 h of the customer's last message it is a normal reply; up to 7 days
 * it goes as a "human agent" message (needs Meta's Human Agent permission); later Meta refuses it.
 */
export async function sendSocialText(t: { page_id: string; psid: string; last_inbound_at: string | null }, text: string): Promise<{ mid?: string; error?: string }> {
  const token = await pageToken(t.page_id);
  if (!token) return { error: "The Facebook page is no longer connected." };
  const age = t.last_inbound_at ? Date.now() - new Date(t.last_inbound_at).getTime() : Infinity;
  if (age > 7 * 86400000) return { error: "The customer has not written in the last 7 days, so Meta does not allow a reply. Wait for them to message again." };
  const body = age <= 24 * 3600000
    ? { recipient: { id: t.psid }, messaging_type: "RESPONSE", message: { text } }
    : { recipient: { id: t.psid }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT", message: { text } };
  const r = await graph<{ message_id?: string }>(token, `${t.page_id}/messages`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) return { error: r.message };
  return { mid: r.data.message_id };
}
