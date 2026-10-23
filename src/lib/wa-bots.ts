import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "./supabase/server";
import { DEFAULT_PREFS, insideHours, keywordHit, pickBot, splitKeywords, type WaBot, type WaPrefs } from "./wa";

type Db = ReturnType<typeof createAdminClient>;
type Inbound = { messageId: string; conversationId: string; companyId: string; body: string | null; type: string };

const TEXT_TYPES = ["text", "button", "interactive"];

/** Stable uuid per (inbound message, purpose) so webhook replays never send a second reply. */
function stableId(...parts: string[]) {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function loadPrefs(db: Db, companyId: string): Promise<WaPrefs> {
  const { data } = await db.from("lb_wa_prefs").select("*").eq("company_id", companyId).maybeSingle();
  return { ...DEFAULT_PREFS, ...(data ?? {}), hours_from: (data?.hours_from ?? DEFAULT_PREFS.hours_from).slice(0, 5), hours_to: (data?.hours_to ?? DEFAULT_PREFS.hours_to).slice(0, 5) };
}

/** Queue an automated text reply inside the 24h window (the customer just wrote). Drained by the webhook's outbox run. */
async function queueReply(db: Db, ev: Inbound, body: string, purpose: string) {
  const text = body.trim().slice(0, 4096);
  if (!text) return;
  const { error } = await db.from("lb_messages").insert({
    company_id: ev.companyId, conversation_id: ev.conversationId, direction: "out", type: "text", body: text,
    client_id: stableId(ev.messageId, purpose), status: "queued", next_attempt_at: new Date().toISOString(), automated: true,
  });
  if (error && error.code !== "23505") throw new Error(`bot reply: ${error.message}`);
  if (!error) {
    await db.from("lb_conversations").update({ last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 140), updated_at: new Date().toISOString() }).eq("id", ev.conversationId);
  }
}

async function log(db: Db, ev: Inbound, kind: string, extra: { bot_id?: string; detail?: string } = {}) {
  const { error } = await db.from("lb_wa_bot_events").insert({
    company_id: ev.companyId, conversation_id: ev.conversationId, inbound_message_id: ev.messageId, kind, body: ev.body?.slice(0, 500) ?? null, ...extra,
  });
  return !error; // false = already handled (unique per message+kind)
}

/**
 * Runs after an inbound message is stored: opt-out/opt-in keywords, keyword bots, away message.
 * Never throws into the webhook: a bot problem must not block message ingestion.
 */
export async function runAutoReplies(ev: Inbound) {
  if (!ev.body || !TEXT_TYPES.includes(ev.type)) return;
  const db = createAdminClient();
  try {
    const prefs = await loadPrefs(db, ev.companyId);
    const { data: conv } = await db.from("lb_conversations").select("id,number_id,customer_id,assignee_id").eq("id", ev.conversationId).single();
    if (!conv) return;

    if (prefs.optout_enabled) {
      const out = keywordHit(ev.body, splitKeywords(prefs.optout_keywords));
      if (out) {
        if (await log(db, ev, "optout", { detail: out })) {
          await db.from("lb_customers").update({ wa_opted_out_at: new Date().toISOString() }).eq("id", conv.customer_id);
          await db.from("lb_consent_events").insert({ company_id: ev.companyId, customer_id: conv.customer_id, status: "opt_out", source: "keyword", note: `Keyword "${out}"` });
          if (prefs.optout_reply) await queueReply(db, ev, prefs.optout_reply, "optout");
        }
        return;
      }
      const inn = keywordHit(ev.body, splitKeywords(prefs.optin_keywords));
      if (inn) {
        if (await log(db, ev, "optin", { detail: inn })) {
          await db.from("lb_customers").update({ wa_opted_out_at: null, wa_opt_in_at: new Date().toISOString() }).eq("id", conv.customer_id);
          await db.from("lb_consent_events").insert({ company_id: ev.companyId, customer_id: conv.customer_id, status: "opt_in", source: "keyword", note: `Keyword "${inn}"` });
          if (prefs.optin_reply) await queueReply(db, ev, prefs.optin_reply, "optin");
        }
        return;
      }
    }

    if (prefs.pause_bots_when_assigned && conv.assignee_id) {
      // A human owns this chat; still answer out of hours with the away message.
      await maybeAway(db, ev, prefs);
      return;
    }

    const { data: bots } = await db.from("lb_wa_bots").select("*").eq("company_id", ev.companyId).eq("is_active", true).order("priority");
    const inside = insideHours(prefs);
    const hit = pickBot((bots ?? []) as WaBot[], ev.body, { numberId: conv.number_id, insideHours: inside });
    if (hit) {
      if (await log(db, ev, "reply", { bot_id: hit.bot.id, detail: hit.keyword })) {
        await queueReply(db, ev, hit.bot.reply, `bot:${hit.bot.id}`);
        await db.from("lb_wa_bots").update({ reply_count: hit.bot.reply_count + 1 }).eq("id", hit.bot.id);
      }
      return;
    }
    await log(db, ev, "unmatched");
    await maybeAway(db, ev, prefs);
  } catch (e) {
    console.error("auto-reply failed:", (e as Error).message);
  }
}

/** Away message: outside business hours, at most once per conversation every 12 hours. */
async function maybeAway(db: Db, ev: Inbound, prefs: WaPrefs) {
  if (!prefs.hours_enabled || !prefs.away_message || insideHours(prefs)) return;
  const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const { count } = await db.from("lb_wa_bot_events").select("id", { count: "exact", head: true })
    .eq("conversation_id", ev.conversationId).eq("kind", "away").gte("created_at", since);
  if (count) return;
  if (await log(db, ev, "away")) await queueReply(db, ev, prefs.away_message, "away");
}
