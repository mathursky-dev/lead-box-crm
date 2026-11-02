import "server-only";
import webpush from "web-push";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { graph, numberCredentials } from "./whatsapp";
import { isDemoCompany } from "./demo";
import { normalizePhone } from "./util";

// Staff alerts queue (lb_alert_queue): web push to a user's phones/browsers and
// WhatsApp messages from the company's business number to the user's own phone.
// Rows are created in the database (missed follow-ups, daily missed list, any
// notification for push subscribers); /api/jobs/run calls drainAlerts().

type Alert = {
  id: string; company_id: string; user_id: string; channel: "push" | "whatsapp"; kind: string;
  title: string; body: string | null; link: string | null; attempts: number;
};
type Db = ReturnType<typeof createAdminClient>;

export const APP_URL = (process.env.APP_URL || "https://wacrm.leadboxs.in").replace(/\/+$/, "");

/**
 * VAPID keys for web push. Taken from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) when set,
 * otherwise generated once and kept in lb_settings (service-role only), so push works
 * without any setup.
 */
let vapidCache: { publicKey: string; privateKey: string } | null = null;
export async function vapidKeys(db: Db = createAdminClient()) {
  if (vapidCache) return vapidCache;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return (vapidCache = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
  }
  const read = async () => {
    const { data } = await db.from("lb_settings").select("key,value").in("key", ["vapid_public", "vapid_private"]);
    const m = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
    return m.get("vapid_public") && m.get("vapid_private") ? { publicKey: m.get("vapid_public")!, privateKey: m.get("vapid_private")! } : null;
  };
  let keys = await read();
  if (!keys) {
    const k = webpush.generateVAPIDKeys();
    // Two servers racing: the first insert wins and both read it back.
    await db.from("lb_settings").upsert([{ key: "vapid_public", value: k.publicKey }, { key: "vapid_private", value: k.privateKey }], { onConflict: "key", ignoreDuplicates: true });
    keys = await read();
  }
  if (!keys) throw new Error("Could not set up push keys");
  return (vapidCache = keys);
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

async function sendPush(db: Db, a: Alert): Promise<{ ok: boolean; error?: string; retry?: boolean }> {
  const { data: subs } = await db.from("lb_push_subs").select("id,endpoint,p256dh,auth,failures").eq("user_id", a.user_id);
  if (!subs?.length) return { ok: false, error: "No phone or browser has notifications turned on" };
  const keys = await vapidKeys(db);
  const payload = JSON.stringify({ title: a.title, body: a.body ?? "", url: a.link ?? "/", tag: `${a.kind}:${a.id}` });
  let delivered = 0, lastErr = "";
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        vapidDetails: { subject: `mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@leadboxs.in"}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 60 * 60 * 12, urgency: "high", timeout: 10000,
      });
      delivered++;
      await db.from("lb_push_subs").update({ failures: 0, last_ok_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      lastErr = `Push ${code ?? ""} ${(e as Error).message}`.trim();
      // 404/410: the browser dropped the subscription. Remove it (also after many failures).
      if (code === 404 || code === 410 || s.failures >= 9) await db.from("lb_push_subs").delete().eq("id", s.id);
      else await db.from("lb_push_subs").update({ failures: s.failures + 1 }).eq("id", s.id);
    }
  }
  return delivered ? { ok: true } : { ok: false, error: lastErr || "Push failed", retry: false };
}

async function sendWhatsApp(db: Db, a: Alert): Promise<{ ok: boolean; error?: string; retry?: boolean }> {
  if (await isDemoCompany(a.company_id)) return { ok: false, error: "Demo company: WhatsApp is off" };
  const [{ data: s }, { data: u }] = await Promise.all([
    db.from("lb_alert_settings").select("wa_enabled,wa_number_id,wa_template,wa_template_lang").eq("company_id", a.company_id).maybeSingle(),
    db.from("lb_profiles").select("full_name,phone").eq("id", a.user_id).maybeSingle(),
  ]);
  if (!s?.wa_enabled || !s.wa_number_id) return { ok: false, error: "WhatsApp alerts are turned off" };
  const to = u?.phone ? normalizePhone(u.phone)?.replace(/^\+/, "") : null;
  if (!to) return { ok: false, error: "User has no valid mobile number" };
  const c = await numberCredentials(s.wa_number_id).catch(() => null);
  if (!c || !c.is_active) return { ok: false, error: "Alert WhatsApp number is disconnected" };
  const link = a.link ? `${APP_URL}${a.link}` : APP_URL;
  const text = oneLine(`${a.title}${a.body ? ` · ${a.body}` : ""} · ${link}`, 900);
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  // A template reaches the user any time; plain text only inside 24h of their last message to this number
  // (QR-connected numbers can always send text).
  const payload = s.wa_template && c.provider !== "qr"
    ? { ...base, type: "template", template: { name: s.wa_template, language: { code: s.wa_template_lang || "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: oneLine(u?.full_name || "there", 60) }, { type: "text", text }] }] } }
    : { ...base, type: "text", text: { body: `🔔 *${a.title}*\n${a.body ?? ""}\n${link}`, preview_url: false } };
  const r = await graph<{ messages?: { id: string }[] }>(c.token, `${c.endpoint}/messages`, { method: "POST", body: JSON.stringify(payload) });
  if (r.ok) return { ok: true };
  const hint = r.code === 131047 || r.code === 131026 ? " (outside the 24h window: set an approved alert template in Follow-up alerts settings)" : "";
  return { ok: false, error: `${r.message}${hint}`, retry: !r.ambiguous && (r.status === 0 || r.status === 429 || r.status >= 500) };
}

/** Sends queued staff alerts. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function drainAlerts(budgetMs = 15000) {
  if (!hasServiceRole()) return { sent: 0, failed: 0 };
  const db = createAdminClient();
  const started = Date.now();
  let sent = 0, failed = 0;
  while (Date.now() - started < budgetMs) {
    const { data, error } = await db.rpc("lb_claim_alerts", { p_limit: 20 });
    if (error) { console.error("claim_alerts failed:", error.message); break; }
    const batch = (data ?? []) as Alert[];
    if (!batch.length) break;
    await Promise.all(batch.map(async (a) => {
      let r: { ok: boolean; error?: string; retry?: boolean };
      try {
        r = a.channel === "push" ? await sendPush(db, a) : await sendWhatsApp(db, a);
      } catch (e) {
        r = { ok: false, error: (e as Error).message, retry: true };
      }
      const now = new Date();
      if (r.ok) {
        sent++;
        await db.from("lb_alert_queue").update({ status: "sent", sent_at: now.toISOString(), error: null, locked_at: null }).eq("id", a.id);
      } else if (r.retry && a.attempts < 4) {
        await db.from("lb_alert_queue").update({ status: "queued", error: r.error, locked_at: null, next_attempt_at: new Date(now.getTime() + 60000 * 2 ** a.attempts).toISOString() }).eq("id", a.id);
      } else {
        failed++;
        await db.from("lb_alert_queue").update({ status: "failed", error: r.error?.slice(0, 500), locked_at: null }).eq("id", a.id);
      }
    }));
  }
  return { sent, failed };
}
