import "server-only";
import { createHash, createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { decryptSecret, normalizePhone } from "./util";

export type ConnectorKind = "google" | "indiamart" | "justdial" | "widget" | "webhook";
export type Connector = {
  id: string; company_id: string; kind: ConnectorKind; name: string; token: string; secret_enc: string | null; is_active: boolean;
  config: Record<string, unknown>; last_sync_at: string | null;
};
/** A lead as read from any source, before it goes to lb_ingest_external_lead. */
export type InLead = { phone: string; name?: string; email?: string; location?: string; notes?: string; ext_id?: string; fields?: Record<string, unknown> };

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const pick = (o: Record<string, unknown>, keys: string[]) => {
  const lower = new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase().replace(/[\s-]/g, "_"), v]));
  for (const k of keys) { const v = s(lower.get(k)); if (v) return v; }
  return "";
};
const join = (...parts: string[]) => parts.filter(Boolean).join(", ");

// ------------------------------------------------------------- parsers
/** Google Ads lead form extension webhook: { lead_id, google_key, user_column_data: [{ column_id, string_value }] }. */
export function parseGoogle(body: Record<string, unknown>): InLead {
  const cols = new Map<string, string>();
  for (const c of (Array.isArray(body.user_column_data) ? body.user_column_data : []) as Record<string, unknown>[]) {
    cols.set(s(c.column_id).toUpperCase(), s(c.string_value));
  }
  const g = (k: string) => cols.get(k) ?? "";
  const name = g("FULL_NAME") || join(g("FIRST_NAME"), g("LAST_NAME")).replace(", ", " ");
  const known = new Set(["FULL_NAME", "FIRST_NAME", "LAST_NAME", "PHONE_NUMBER", "WORK_PHONE", "EMAIL", "WORK_EMAIL", "CITY"]);
  const extra = [...cols].filter(([k, v]) => !known.has(k) && v).map(([k, v]) => `${k.replace(/_/g, " ").toLowerCase()}: ${v}`);
  return {
    phone: g("PHONE_NUMBER") || g("WORK_PHONE"), name, email: g("EMAIL") || g("WORK_EMAIL"), location: g("CITY"),
    notes: extra.join("\n"), ext_id: s(body.lead_id),
    fields: { campaign_id: body.campaign_id, form_id: body.form_id, adgroup_id: body.adgroup_id, gcl_id: body.gcl_id, is_test: body.is_test, columns: Object.fromEntries(cols) },
  };
}

/** IndiaMART lead (push RESPONSE object or one row of the CRM pull API). */
export function parseIndiamart(r: Record<string, unknown>): InLead {
  const g = (k: string) => s(r[k]);
  const notes = [g("SUBJECT"), g("QUERY_PRODUCT_NAME") && `Product: ${g("QUERY_PRODUCT_NAME")}`, g("QUERY_MESSAGE").replace(/<br\s*\/?>/gi, "\n"),
    g("SENDER_COMPANY") && `Company: ${g("SENDER_COMPANY")}`, g("SENDER_ADDRESS") && `Address: ${g("SENDER_ADDRESS")}`,
    g("SENDER_MOBILE_ALT") && `Alt mobile: ${g("SENDER_MOBILE_ALT")}`, g("QUERY_TYPE") && `Type: ${({ W: "Direct enquiry", B: "Buy lead", P: "Call (PNS)" } as Record<string, string>)[g("QUERY_TYPE")] ?? g("QUERY_TYPE")}`]
    .filter(Boolean).join("\n");
  return {
    phone: g("SENDER_MOBILE") || g("SENDER_PHONE") || g("SENDER_MOBILE_ALT"), name: g("SENDER_NAME"), email: g("SENDER_EMAIL") || g("SENDER_EMAIL_ALT"),
    location: join(g("SENDER_CITY"), g("SENDER_STATE")), notes, ext_id: g("UNIQUE_QUERY_ID"),
    fields: { query_time: g("QUERY_TIME"), product: g("QUERY_PRODUCT_NAME"), query_type: g("QUERY_TYPE"), company: g("SENDER_COMPANY"), pincode: g("SENDER_PINCODE") },
  };
}

/** JustDial lead push (query string or form fields: leadid, name, mobile, email, city, area, category …). */
export function parseJustdial(o: Record<string, unknown>): InLead {
  const g = (k: string) => pick(o, [k]);
  const name = join(g("prefix"), g("name")).replace(", ", " ").trim();
  const notes = [g("category") && `Category: ${g("category")}`, g("company") && `Company: ${g("company")}`, g("brancharea") && `Branch area: ${g("brancharea")}`,
    g("leadtype") && `Lead type: ${g("leadtype")}`, (g("date") || g("time")) && `JustDial time: ${join(g("date"), g("time"))}`].filter(Boolean).join("\n");
  return { phone: g("mobile") || g("phone"), name, email: g("email"), location: join(g("area"), g("city"), g("pincode")), notes, ext_id: g("leadid"), fields: o };
}

/** Generic webhook / Zapier / Pabbly / website chat: common field names. */
export function parseGeneric(o: Record<string, unknown>): InLead {
  const first = pick(o, ["first_name", "firstname"]), last = pick(o, ["last_name", "lastname"]);
  const known = new Set(["phone", "mobile", "phone_number", "mobile_number", "whatsapp", "contact", "contact_number", "number", "name", "full_name", "fullname",
    "first_name", "firstname", "last_name", "lastname", "email", "email_address", "city", "location", "address", "notes", "message", "remarks", "comment", "comments",
    "id", "lead_id", "ext_id", "website", "token"]);
  const extra = Object.entries(o).filter(([k, v]) => !known.has(k.toLowerCase()) && s(v) && typeof v !== "object").map(([k, v]) => `${k}: ${s(v)}`);
  const msg = pick(o, ["notes", "message", "remarks", "comment", "comments"]);
  return {
    phone: pick(o, ["phone", "mobile", "phone_number", "mobile_number", "whatsapp", "contact", "contact_number", "number"]),
    name: pick(o, ["name", "full_name", "fullname"]) || `${first} ${last}`.trim(),
    email: pick(o, ["email", "email_address"]), location: pick(o, ["city", "location", "address"]),
    notes: [msg, ...extra].filter(Boolean).join("\n").slice(0, 4000), ext_id: pick(o, ["lead_id", "ext_id", "id"]), fields: o,
  };
}

// ------------------------------------------------------------- ingest
export type IngestResult = { status: "created" | "duplicate" | "already_received" | "invalid"; lead_id?: string; lead_no?: number; error?: string };

export async function ingest(c: Connector, lead: InLead, country = "IN"): Promise<IngestResult> {
  const phone = normalizePhone(lead.phone.replace(/[\s\-().]/g, ""), country);
  const db = createAdminClient();
  if (!phone) {
    await db.from("lb_lead_connectors").update({ last_error: `Lead without valid phone (${lead.phone || "empty"})`, last_error_at: new Date().toISOString() }).eq("id", c.id);
    return { status: "invalid", error: "Valid phone number required" };
  }
  const label = { google: "Google Ads lead form", indiamart: "IndiaMART enquiry", justdial: "JustDial enquiry", widget: "Website chat", webhook: "Webhook" }[c.kind];
  const { data, error } = await db.rpc("lb_ingest_external_lead", {
    p_connector: c.id,
    p: { phone_e164: phone, name: lead.name?.slice(0, 200) ?? "", email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email ?? "") ? lead.email : "",
      location: lead.location?.slice(0, 200) ?? "", notes: lead.notes?.slice(0, 5000) ?? "", ext_id: lead.ext_id?.slice(0, 200) || null,
      text: `${label} (${c.name})${lead.notes ? `\n${lead.notes.slice(0, 1500)}` : ""}`, fields: lead.fields ?? {} },
  });
  if (error) {
    await db.from("lb_lead_connectors").update({ last_error: error.message.slice(0, 300), last_error_at: new Date().toISOString() }).eq("id", c.id);
    return { status: "invalid", error: error.message };
  }
  return data as IngestResult;
}

export async function connectorByToken(kind: ConnectorKind, token: string) {
  if (!/^[a-f0-9]{32,64}$/.test(token) || !hasServiceRole()) return null;
  const { data } = await createAdminClient().from("lb_lead_connectors")
    .select("id,company_id,kind,name,token,secret_enc,is_active,config,last_sync_at").eq("token", token).eq("kind", kind).maybeSingle();
  return (data as Connector | null) ?? null;
}

export async function companyCountry(companyId: string) {
  const { data } = await createAdminClient().from("lb_companies").select("default_country").eq("id", companyId).maybeSingle();
  return (data?.default_country as string | undefined) ?? "IN";
}

// --------------------------------------------------------- IndiaMART pull
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** IndiaMART wants IST as DD-Mon-YYYYHH:MM:SS. */
function imTime(d: Date) {
  const t = new Date(d.getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}-${MON[t.getUTCMonth()]}-${t.getUTCFullYear()}${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

/** One pull for one connector. IndiaMART allows one call per 5 minutes per key. */
export async function pullIndiamart(c: Connector): Promise<{ ok: boolean; fetched: number; created: number; message: string }> {
  const db = createAdminClient();
  if (!c.secret_enc) return { ok: false, fetched: 0, created: 0, message: "No CRM key saved" };
  const now = new Date();
  const since = c.last_sync_at ? new Date(Math.max(new Date(c.last_sync_at).getTime() - 15 * 60_000, now.getTime() - 6.9 * 864e5)) : new Date(now.getTime() - 864e5);
  // Mark the attempt first so a slow or failing call is not retried every minute.
  await db.from("lb_lead_connectors").update({ last_sync_at: now.toISOString() }).eq("id", c.id);
  let key: string;
  try { key = decryptSecret(c.secret_enc); } catch { return { ok: false, fetched: 0, created: 0, message: "Saved CRM key could not be read; save it again" }; }
  const url = `https://mapi.indiamart.com/wservce/crm/crmListing/v2/?glusr_crm_key=${encodeURIComponent(key)}&start_time=${imTime(since)}&end_time=${imTime(now)}`;
  let body: { CODE?: number; STATUS?: string; MESSAGE?: string; TOTAL_RECORDS?: number; RESPONSE?: Record<string, unknown>[] | string };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), cache: "no-store" });
    body = await res.json();
  } catch (e) {
    const message = `IndiaMART not reachable: ${(e as Error).message}`;
    await db.from("lb_lead_connectors").update({ last_error: message, last_error_at: now.toISOString() }).eq("id", c.id);
    return { ok: false, fetched: 0, created: 0, message };
  }
  if (body.CODE === 204 || (body.CODE === 200 && !Array.isArray(body.RESPONSE))) return { ok: true, fetched: 0, created: 0, message: "Connected. No new enquiries in this window." };
  if (body.CODE !== 200 || !Array.isArray(body.RESPONSE)) {
    const message = `IndiaMART: ${body.MESSAGE || body.STATUS || `code ${body.CODE}`}`.slice(0, 300);
    await db.from("lb_lead_connectors").update({ last_error: message, last_error_at: now.toISOString() }).eq("id", c.id);
    return { ok: false, fetched: 0, created: 0, message };
  }
  const country = await companyCountry(c.company_id);
  let created = 0;
  for (const row of body.RESPONSE) {
    const r = await ingest(c, parseIndiamart(row), country);
    if (r.status === "created") created++;
  }
  return { ok: true, fetched: body.RESPONSE.length, created, message: `Connected. ${body.RESPONSE.length} enquiries read, ${created} new leads.` };
}

/** Job runner: pull every active IndiaMART CRM key that has not synced for 10 minutes. */
export async function syncIndiamartDue(limit = 5) {
  if (!hasServiceRole()) return { synced: 0 };
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await createAdminClient().from("lb_lead_connectors")
    .select("id,company_id,kind,name,token,secret_enc,is_active,config,last_sync_at")
    .eq("kind", "indiamart").eq("is_active", true).not("secret_enc", "is", null)
    .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`).limit(limit);
  let synced = 0;
  for (const c of (data ?? []) as Connector[]) { await pullIndiamart(c); synced++; }
  return { synced };
}

// ------------------------------------------------------ outgoing webhooks
export const WEBHOOK_EVENTS = ["lead.created", "lead.status_changed", "lead.assigned"] as const;

export function signBody(secret: string, ts: string, body: string) {
  return "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
}

const privateIp = (ip: string): boolean => {
  if (isIP(ip) === 6) { const l = ip.toLowerCase(); return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || (l.startsWith("::ffff:") && privateIp(l.slice(7))) || l === "::"; }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};

/** Outgoing webhooks may only call public https hosts (no localhost / private network). */
export async function checkWebhookUrl(raw: string): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return "Enter a full URL like https://example.com/hook"; }
  if (u.protocol !== "https:") return "The URL must start with https://";
  if (u.username || u.password) return "Do not put a username or password in the URL";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return "Private hosts are not allowed";
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return "Private network addresses are not allowed";
  } catch { return `Could not find the host ${host}`; }
  return null;
}

export async function postWebhook(url: string, secret: string, event: string, payload: unknown) {
  const bad = await checkWebhookUrl(url);
  if (bad) return { ok: false, code: null, error: bad };
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const res = await fetch(url, {
      method: "POST", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "User-Agent": "LeadBox-Webhooks/1.0", "X-LeadBox-Event": event, "X-LeadBox-Timestamp": ts, "X-LeadBox-Signature": signBody(secret, ts, body) },
      body,
    });
    return { ok: res.status >= 200 && res.status < 300, code: res.status, error: res.status >= 300 ? `HTTP ${res.status}` : null };
  } catch (e) {
    return { ok: false, code: null, error: (e as Error).message.slice(0, 300) };
  }
}

/** Sends queued webhook calls; 6 tries with back-off (1, 5, 15, 60, 180 min), then failed. */
export async function drainWebhooks(budgetMs = 15000) {
  if (!hasServiceRole()) return { sent: 0, failed: 0 };
  const db = createAdminClient();
  const t0 = Date.now();
  let sent = 0, failed = 0;
  const secrets = new Map<string, { url: string; secret: string; active: boolean } | null>();
  while (Date.now() - t0 < budgetMs) {
    const { data: rows, error } = await db.rpc("lb_claim_webhook_deliveries", { p_limit: 20 });
    if (error || !rows?.length) break;
    await Promise.all((rows as { id: number; webhook_id: string; event: string; payload: unknown; attempts: number }[]).map(async (d) => {
      if (!secrets.has(d.webhook_id)) {
        const { data: w } = await db.from("lb_webhooks").select("url,secret_enc,is_active").eq("id", d.webhook_id).maybeSingle();
        let secret = "";
        try { secret = w ? decryptSecret(w.secret_enc) : ""; } catch { /* unreadable secret → fail below */ }
        secrets.set(d.webhook_id, w && secret ? { url: w.url, secret, active: w.is_active } : null);
      }
      const w = secrets.get(d.webhook_id);
      const r = w?.active ? await postWebhook(w.url, w.secret, d.event, d.payload) : { ok: false, code: null, error: w ? "Webhook paused" : "Webhook secret unreadable" };
      const now = new Date().toISOString();
      if (r.ok) {
        sent++;
        await db.from("lb_webhook_deliveries").update({ status: "sent", sent_at: now, response_code: r.code, error: null, locked_at: null }).eq("id", d.id);
        await db.from("lb_webhooks").update({ last_status: r.code, last_error: null, last_sent_at: now, failures: 0 }).eq("id", d.webhook_id);
      } else {
        const delays = [1, 5, 15, 60, 180];
        const giveUp = !w?.active || d.attempts >= 6;
        if (giveUp) failed++;
        await db.from("lb_webhook_deliveries").update({
          status: giveUp ? "failed" : "queued", response_code: r.code, error: r.error, locked_at: null,
          next_attempt_at: new Date(Date.now() + (delays[d.attempts - 1] ?? 180) * 60_000).toISOString(),
        }).eq("id", d.id);
        await db.from("lb_webhooks").update({ last_status: r.code, last_error: r.error, last_sent_at: now }).eq("id", d.webhook_id);
      }
    }));
  }
  return { sent, failed };
}

// --------------------------------------------------------------- API keys
export const hashKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");
