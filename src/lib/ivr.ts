import "server-only";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { decryptSecret, normalizePhone } from "./util";

// Cloud calling (Exotel / Knowlarity). Click-to-call rings the agent's own mobile first and then
// connects the customer from the company's virtual number; the provider records the call and
// calls /api/ivr/<provider>/<hook_token> when it ends. Incoming IVR calls use the same URL.

export type IvrProvider = "exotel" | "knowlarity";
export type IvrSettings = {
  company_id: string; provider: IvrProvider; enabled: boolean; account_sid: string | null; api_host: string | null; api_key: string | null;
  api_token_enc: string | null; caller_id: string | null; record: boolean; hook_token: string;
};
export const IVR_PROVIDERS: { value: IvrProvider; label: string }[] = [
  { value: "exotel", label: "Exotel" }, { value: "knowlarity", label: "Knowlarity (SuperReceptionist)" },
];

type Db = ReturnType<typeof createAdminClient>;

export async function ivrSettings(db: Db, companyId: string): Promise<IvrSettings | null> {
  const { data, error } = await db.from("lb_ivr_settings").select("*").eq("company_id", companyId).maybeSingle();
  if (error || !data) return null;
  return data as IvrSettings;
}

const timeout = () => AbortSignal.timeout(20000);
const exotelHost = (h: string | null) => (h || "api.exotel.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** Start a click-to-call. Returns the provider's call id. */
export async function startIvrCall(s: IvrSettings, agent: string, customer: string, callbackUrl: string): Promise<{ id?: string; error?: string }> {
  if (!s.api_key || !s.api_token_enc || !s.caller_id) return { error: "Calling keys are not saved yet." };
  const token = decryptSecret(s.api_token_enc);
  try {
    if (s.provider === "exotel") {
      if (!s.account_sid) return { error: "Exotel Account SID is missing." };
      const body = new URLSearchParams({ From: agent, To: customer, CallerId: s.caller_id, CallType: "trans", StatusCallback: callbackUrl, "StatusCallbackEvents[0]": "terminal" });
      if (s.record) { body.set("Record", "true"); body.set("RecordingChannels", "dual"); }
      const r = await fetch(`https://${exotelHost(s.api_host)}/v1/Accounts/${encodeURIComponent(s.account_sid)}/Calls/connect.json`, {
        method: "POST", body, signal: timeout(), cache: "no-store",
        headers: { Authorization: `Basic ${Buffer.from(`${s.api_key}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      });
      const j = (await r.json().catch(() => ({}))) as { Call?: { Sid?: string }; RestException?: { Message?: string } };
      if (!r.ok || !j.Call?.Sid) return { error: `Exotel: ${j.RestException?.Message ?? `HTTP ${r.status}`}` };
      return { id: j.Call.Sid };
    }
    const r = await fetch("https://kpi.knowlarity.com/Basic/v1/account/call/makecall", {
      method: "POST", signal: timeout(), cache: "no-store",
      headers: { "x-api-key": s.api_key, Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ k_number: s.caller_id, agent_number: agent, customer_number: customer, caller_id: s.caller_id }),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: { call_id?: string; status?: string }; error?: { message?: string; code?: string } | string; message?: string };
    const id = j.success?.call_id;
    if (!r.ok || !id) return { error: `Knowlarity: ${typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? `HTTP ${r.status}`}` };
    return { id };
  } catch (e) {
    return { error: `Could not reach ${s.provider === "exotel" ? "Exotel" : "Knowlarity"}: ${(e as Error).message}` };
  }
}

/** Light check of the saved keys (no call is placed). */
export async function testIvr(s: IvrSettings): Promise<string> {
  if (!s.api_key || !s.api_token_enc) throw new Error("Keys missing");
  const token = decryptSecret(s.api_token_enc);
  if (s.provider === "exotel") {
    const r = await fetch(`https://${exotelHost(s.api_host)}/v1/Accounts/${encodeURIComponent(s.account_sid ?? "")}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${s.api_key}:${token}`).toString("base64")}` }, signal: timeout(), cache: "no-store",
    });
    if (!r.ok) throw new Error(`Exotel rejected the keys (HTTP ${r.status}). Check SID, API key, token and API host.`);
    return "Exotel keys work.";
  }
  const r = await fetch("https://kpi.knowlarity.com/Basic/v1/account/calllog?limit=1", {
    headers: { "x-api-key": s.api_key, Authorization: token, Accept: "application/json" }, signal: timeout(), cache: "no-store",
  });
  if (r.status === 401 || r.status === 403) throw new Error(`Knowlarity rejected the keys (HTTP ${r.status}).`);
  return "Knowlarity keys accepted.";
}

/** Read a callback (query string, form or JSON) into one flat map with lower-case keys. */
export async function readCallback(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => { if (v !== null && v !== undefined && typeof v !== "object") out[k.toLowerCase()] = String(v); };
  new URL(req.url).searchParams.forEach((v, k) => put(k, v));
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    const raw = await req.text().catch(() => "");
    if (/json/.test(type) || /^\s*[{[]/.test(raw)) {
      try {
        const j = JSON.parse(raw);
        const flat = (o: Record<string, unknown>, depth = 0) => { for (const [k, v] of Object.entries(o ?? {})) { if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) flat(v as Record<string, unknown>, depth + 1); else put(k, v); } };
        flat(Array.isArray(j) ? j[0] : j);
      } catch { /* not JSON */ }
    } else {
      new URLSearchParams(raw).forEach((v, k) => put(k, v));
    }
  }
  return out;
}

const pick = (m: Record<string, string>, ...keys: string[]) => keys.map((k) => m[k.toLowerCase()]).find((v) => v !== undefined && v !== "") ?? "";

/** "2026-11-02 14:05:00" (IST when no zone is given), ISO or epoch seconds. */
function parseStart(v: string) {
  if (!v) return null;
  if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1000).toISOString();
  const iso = v.trim().replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v.trim()) ? "" : "+05:30");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Map a provider callback to the lb_ivr_save_call payload. */
export function mapCallback(provider: IvrProvider, m: Record<string, string>, country = "IN") {
  const dirRaw = pick(m, "Direction", "call_direction", "Call_Type", "calltype", "type").toLowerCase();
  const inbound = /in(bound|coming)?$|^incoming|^inbound/.test(dirRaw);
  const status = pick(m, "Status", "CallStatus", "call_status", "DialCallStatus", "business_call_type", "event_type").toLowerCase();
  const id = provider === "exotel" ? pick(m, "CallSid", "Sid") : pick(m, "call_id", "uuid", "callid", "call_uuid");
  const customerRaw = provider === "exotel"
    ? (inbound ? pick(m, "CallFrom", "From") : pick(m, "To", "CallTo"))
    : pick(m, "customer_number", "caller_id", "callerid", "customer", "caller_number");
  const agentRaw = provider === "exotel"
    ? (inbound ? pick(m, "DialWhomNumber", "AgentNumber") : pick(m, "From", "CallFrom"))
    : pick(m, "agent_number", "destination", "agent");
  const duration = Number(pick(m, "ConversationDuration", "DialCallDuration", "Duration", "call_duration", "duration", "billsec")) || 0;
  const missed = inbound && (duration === 0 || /no-?answer|missed|busy|failed|cancel/.test(status));
  const started = pick(m, "StartTime", "start_time", "call_start_time", "CallStartTime", "start");
  const startedIso = parseStart(started) ?? new Date(Date.now() - duration * 1000).toISOString();
  return {
    provider, call_id: id,
    phone: normalizePhone(customerRaw, country), agent_phone: normalizePhone(agentRaw, country),
    direction: inbound ? (missed ? "missed" : "incoming") : "outgoing",
    status: status.slice(0, 40), duration, started_at: startedIso,
    recording_url: pick(m, "RecordingUrl", "recording_url", "call_recording", "recordingurl", "recording").slice(0, 1000) || null,
  };
}

/** Copy provider recordings into the private lb-calls bucket (company switch respected). */
export async function fetchIvrRecordings(limit = 3) {
  if (!hasServiceRole()) return 0;
  const db = createAdminClient();
  const { data, error } = await db.from("lb_calls").select("id,company_id,provider,recording_url").eq("source", "ivr").not("recording_url", "is", null).is("recording_path", null)
    .gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(limit);
  if (error || !data?.length) return 0;
  let n = 0;
  for (const c of data) if (await storeIvrRecording(db, c as { id: string; company_id: string; provider: string; recording_url: string })) n++;
  return n;
}

export async function storeIvrRecording(db: Db, c: { id: string; company_id: string; provider: string; recording_url: string }) {
  const { data: co } = await db.from("lb_companies").select("call_recordings").eq("id", c.company_id).maybeSingle();
  if (co?.call_recordings === false) { await db.from("lb_calls").update({ recording_url: null }).eq("id", c.id); return false; }
  if (!/^https:\/\//.test(c.recording_url)) return false;
  try {
    let r = await fetch(c.recording_url, { signal: timeout(), cache: "no-store" });
    if ((r.status === 401 || r.status === 403) && c.provider === "exotel") {
      const s = await ivrSettings(db, c.company_id);
      if (s?.api_key && s.api_token_enc) {
        r = await fetch(c.recording_url, { signal: timeout(), cache: "no-store", headers: { Authorization: `Basic ${Buffer.from(`${s.api_key}:${decryptSecret(s.api_token_enc)}`).toString("base64")}` } });
      }
    }
    if (!r.ok) return false;
    const mime = (r.headers.get("content-type") ?? "audio/mpeg").split(";")[0];
    const bytes = Buffer.from(await r.arrayBuffer());
    if (!bytes.length || bytes.length > 50 * 1024 * 1024) return false;
    const ext = /wav/.test(mime) ? "wav" : /ogg/.test(mime) ? "ogg" : /mp4|m4a|aac/.test(mime) ? "m4a" : "mp3";
    const path = `${c.company_id}/${c.id}.${ext}`;
    const up = await db.storage.from("lb-calls").upload(path, bytes, { contentType: mime.startsWith("audio/") ? mime : "audio/mpeg", upsert: true });
    if (up.error) return false;
    await db.from("lb_calls").update({ recording_path: path, recording_mime: mime, recording_size: bytes.length, updated_at: new Date().toISOString() }).eq("id", c.id);
    return true;
  } catch { return false; }
}
