import "server-only";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { graph, isRetryable, numberCredentials, markNumberError } from "./whatsapp";

type Msg = {
  id: string; conversation_id: string; type: string; body: string | null; media_path: string | null; media_filename: string | null;
  template_name: string | null; template_language: string | null; template_params: unknown; reply_to_id: string | null;
  payload: Record<string, unknown> | null; next_attempt_at: string;
};

/**
 * Sends queued outbound messages. Rows were persisted before this runs
 * (lb_enqueue_message); lb_claim_outbox locks them (status 'sending') so
 * concurrent drains never send the same row twice.
 */
export async function drainOutbox(budgetMs = 20000) {
  if (!hasServiceRole()) return { sent: 0, failed: 0 };
  const db = createAdminClient();
  const started = Date.now();
  let sent = 0, failed = 0;
  const creds = new Map<string, Awaited<ReturnType<typeof numberCredentials>>>();
  while (Date.now() - started < budgetMs) {
    const { data: batch, error } = await db.rpc("lb_claim_outbox", { p_limit: 10 });
    if (error) { console.error("claim_outbox failed:", error.message); break; }
    if (!batch?.length) break;
    // Flow blocks queue several messages at once; send them in the order they were queued.
    for (const m of (batch as Msg[]).sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))) {
      const { data: conv } = await db.from("lb_conversations").select("number_id, customer:lb_customers(phone_e164)").eq("id", m.conversation_id).single();
      const numberId = conv?.number_id as string;
      if (!creds.has(numberId)) creds.set(numberId, await numberCredentials(numberId).catch(() => null));
      const c = creds.get(numberId);
      if (!c || !c.is_active) {
        await db.rpc("lb_mark_send_result", { p_msg: m.id, p_wamid: null, p_code: "number", p_error: "Business number is disconnected or has no access token.", p_retryable: false });
        failed++;
        continue;
      }
      const to = (conv!.customer as unknown as { phone_e164: string }).phone_e164.replace(/^\+/, "");
      let payload: Record<string, unknown>;
      try {
        payload = await buildPayload(db, m, to);
      } catch (e) {
        await db.rpc("lb_mark_send_result", { p_msg: m.id, p_wamid: null, p_code: "build", p_error: (e as Error).message, p_retryable: false });
        failed++;
        continue;
      }
      const r = await graph<{ messages?: { id: string }[] }>(c.token, `${c.endpoint}/messages`, { method: "POST", body: JSON.stringify(payload) });
      if (r.ok && r.data.messages?.[0]?.id) {
        await db.rpc("lb_mark_send_result", { p_msg: m.id, p_wamid: r.data.messages[0].id, p_code: null, p_error: null, p_retryable: false });
        sent++;
      } else if (!r.ok) {
        if (r.code === 190 || r.code === 10 || r.code === 200) await markNumberError(numberId, `Token/permission error: ${r.message}`);
        const msg = r.ambiguous ? `${r.message}. Outcome unknown — check the customer's chat before retrying.` : r.message;
        await db.rpc("lb_mark_send_result", { p_msg: m.id, p_wamid: null, p_code: r.code != null ? String(r.code) : r.ambiguous ? "unknown" : String(r.status), p_error: msg, p_retryable: isRetryable(r) });
        failed++;
      } else {
        await db.rpc("lb_mark_send_result", { p_msg: m.id, p_wamid: null, p_code: "unknown", p_error: "No message id returned", p_retryable: false });
        failed++;
      }
    }
  }
  return { sent, failed };
}

async function buildPayload(db: ReturnType<typeof createAdminClient>, m: Msg, to: string) {
  let context: { message_id: string } | undefined;
  if (m.reply_to_id) {
    const { data: q } = await db.from("lb_messages").select("wa_message_id").eq("id", m.reply_to_id).maybeSingle();
    if (q?.wa_message_id) context = { message_id: q.wa_message_id };
  }
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to, ...(context ? { context } : {}) };
  if (m.type === "text") return { ...base, type: "text", text: { body: m.body ?? "", preview_url: true } };
  if (m.type === "template") {
    const params = Array.isArray(m.template_params) ? (m.template_params as string[]) : [];
    return {
      ...base, type: "template",
      template: {
        name: m.template_name, language: { code: m.template_language },
        ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}),
      },
    };
  }
  // Flow blocks: interactive buttons/lists/products, location pins, contact cards and media by public link.
  if (m.payload) return { ...base, type: m.type, [m.type]: m.type === "contacts" ? (m.payload as { contacts: unknown }).contacts : m.payload };
  if (!m.media_path) throw new Error("Attachment missing");
  const { data, error } = await db.storage.from("lb-media").createSignedUrl(m.media_path, 3600);
  if (error || !data) throw new Error("Could not read attachment from storage");
  const media: Record<string, string> = { link: data.signedUrl };
  if (m.body && m.type !== "audio") media.caption = m.body;
  if (m.type === "document" && m.media_filename) media.filename = m.media_filename;
  return { ...base, type: m.type, [m.type]: media };
}
