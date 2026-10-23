import "server-only";
import { createAdminClient } from "./supabase/server";
import { decryptSecret } from "./util";

const VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export type GraphResult<T = Record<string, unknown>> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code?: number; message: string; ambiguous?: boolean };

/** Graph API call. `ambiguous` = request may have reached Meta (timeout/connection reset). */
export async function graph<T = Record<string, unknown>>(token: string, path: string, init: RequestInit = {}): Promise<GraphResult<T>> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${GRAPH}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch (e) {
    const code = (e as { cause?: { code?: string } })?.cause?.code;
    const definitelyNotSent = code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EAI_AGAIN";
    return { ok: false, status: 0, message: `Network error${code ? ` (${code})` : ""}`, ambiguous: !definitelyNotSent };
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string; error_data?: { details?: string } } } & T;
  if (res.ok && !json.error) return { ok: true, status: res.status, data: json };
  const err = json.error;
  return { ok: false, status: res.status, code: err?.code, message: [err?.message, err?.error_data?.details].filter(Boolean).join(" — ") || `HTTP ${res.status}` };
}

/** Meta error codes that are safe to retry (request not processed). */
export function isRetryable(r: Extract<GraphResult, { ok: false }>) {
  if (r.ambiguous) return false;
  if (r.status === 0 || r.status === 429 || r.status >= 500) return true;
  return [1, 2, 4, 17, 80007, 130429, 131000, 131016, 133004].includes(r.code ?? -1);
}

export async function numberCredentials(numberId: string) {
  const db = createAdminClient();
  const { data: n } = await db.from("lb_wa_numbers").select("id,company_id,phone_number_id,waba_id,is_active").eq("id", numberId).single();
  const { data: s } = await db.from("lb_wa_number_secrets").select("access_token").eq("number_id", numberId).maybeSingle();
  if (!n || !s) return null;
  return { ...n, token: decryptSecret(s.access_token) };
}

export async function markNumberError(numberId: string, message: string | null) {
  await createAdminClient().from("lb_wa_numbers")
    .update({ status: message ? "error" : "connected", last_error: message, last_checked_at: new Date().toISOString() }).eq("id", numberId);
}

export const phoneInfo = (token: string, phoneNumberId: string) =>
  graph<{ display_phone_number: string; verified_name: string; quality_rating?: string }>(token, `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);

export const subscribeApp = (token: string, wabaId: string) => graph(token, `${wabaId}/subscribed_apps`, { method: "POST" });

export async function listTemplates(token: string, wabaId: string) {
  const out: Record<string, unknown>[] = [];
  let url: string | null = `${wabaId}/message_templates?fields=id,name,language,status,category,components&limit=100`;
  for (let i = 0; url && i < 20; i++) {
    const r: GraphResult<{ data: Record<string, unknown>[]; paging?: { next?: string } }> = await graph(token, url);
    if (!r.ok) return r;
    out.push(...r.data.data);
    url = r.data.paging?.next ?? null;
  }
  return { ok: true as const, status: 200, data: out };
}

/** Download inbound media (2-step: metadata → binary). */
export async function downloadMedia(token: string, mediaId: string) {
  const meta = await graph<{ url: string; mime_type: string; file_size?: number }>(token, mediaId);
  if (!meta.ok) return meta;
  const res = await fetch(meta.data.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { ok: false as const, status: res.status, message: `Media download failed (HTTP ${res.status})` };
  return { ok: true as const, status: 200, data: { bytes: Buffer.from(await res.arrayBuffer()), mime: meta.data.mime_type } };
}
