import "server-only";
import { createAdminClient } from "./supabase/server";
import { decryptSecret, encryptSecret } from "./util";

// Gmail in lead history. Each user connects their own Gmail with Google OAuth (GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET in Vercel). Only mails to/from a customer's email address are stored.

export const GOOGLE_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const redirectUri = (origin: string) => `${process.env.APP_URL || origin}/api/google/callback`;

export function authUrl(origin: string, state: string, hint?: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(origin), response_type: "code", scope: GOOGLE_SCOPES,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, ...(hint ? { login_hint: hint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type Tokens = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; error?: string; error_description?: string };

async function tokenCall(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as Tokens;
  if (!res.ok || j.error) throw new Error(j.error_description || j.error || `Google token error ${res.status}`);
  return j;
}

export const exchangeCode = (code: string, origin: string) => tokenCall({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });

// Access tokens are cached per refresh token for the life of the server instance.
const cache = new Map<string, { token: string; exp: number }>();
export async function accessToken(refreshTokenEnc: string) {
  const hit = cache.get(refreshTokenEnc);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const t = await tokenCall({ refresh_token: decryptSecret(refreshTokenEnc), grant_type: "refresh_token" });
  cache.set(refreshTokenEnc, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

async function gmail<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store", signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Gmail: ${j.error?.message ?? res.status}`);
  return j;
}

export async function gmailProfile(token: string) {
  return gmail<{ emailAddress: string }>(token, "profile");
}

/** Saves (or re-connects) the user's Gmail. */
export async function saveAccount(o: { companyId: string; userId: string; email: string; refreshToken: string }) {
  const { error } = await createAdminClient().from("lb_google_accounts").upsert({
    company_id: o.companyId, user_id: o.userId, email: o.email.toLowerCase(), refresh_token_enc: encryptSecret(o.refreshToken),
    is_active: true, last_error: null, synced_until: null,
  }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ parsing
type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
type GMsg = { id: string; threadId: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: Part };

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const header = (m: GMsg, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
/** "Ravi <ravi@x.com>, b@y.com" → ["ravi@x.com", "b@y.com"] */
export const addresses = (v: string) => [...v.matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((x) => x[0].toLowerCase());

function plainText(p?: Part): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return b64(p.body.data);
  for (const c of p.parts ?? []) { const t = plainText(c); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) return b64(p.body.data).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

function toRow(m: GMsg, me: string, body = "") {
  const from = addresses(header(m, "From"))[0] ?? "";
  const to = [...addresses(header(m, "To")), ...addresses(header(m, "Cc"))];
  return {
    gmail_id: m.id, thread_id: m.threadId, direction: from === me ? "out" : "in", from_email: from, to_emails: to,
    subject: header(m, "Subject"), snippet: (m.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
    body_text: body, sent_at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
  };
}

/** Stores one Gmail message if it involves a customer; then fills in the body. Returns true when stored. */
async function ingest(db: ReturnType<typeof createAdminClient>, token: string, accountId: string, me: string, id: string) {
  const m = await gmail<GMsg>(token, `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`);
  if (m.labelIds?.some((l) => l === "SPAM" || l === "DRAFT")) return false;
  const { data: emailId, error } = await db.rpc("lb_ingest_email", { p_account: accountId, p: toRow(m, me) });
  if (error) throw new Error(error.message);
  if (!emailId) return false;
  const full = await gmail<GMsg>(token, `messages/${id}?format=full`);
  await db.from("lb_emails").update({ body_text: plainText(full.payload).slice(0, 20000) }).eq("id", emailId);
  return true;
}

/** Pulls mails since the last sync (first time: last 30 days, up to 200 mails). */
export async function syncAccount(accountId: string, deadline = Date.now() + 25000) {
  const db = createAdminClient();
  const { data: a } = await db.from("lb_google_accounts").select("id,email,refresh_token_enc,synced_until,is_active").eq("id", accountId).single();
  if (!a?.is_active) return { stored: 0 };
  const started = new Date();
  let stored = 0;
  try {
    const token = await accessToken(a.refresh_token_enc);
    const since = a.synced_until ? new Date(a.synced_until).getTime() - 3600_000 : Date.now() - 30 * 86400_000;
    let pageToken: string | undefined; let seen = 0; let finished = true;
    do {
      const q = new URLSearchParams({ q: `after:${Math.floor(since / 1000)} -in:chats`, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
      const list = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `messages?${q}`);
      for (const { id } of list.messages ?? []) {
        if (Date.now() > deadline) { finished = false; break; }
        const { count } = await db.from("lb_emails").select("id", { count: "exact", head: true }).eq("account_id", a.id).eq("gmail_id", id);
        if (!count && (await ingest(db, token, a.id, a.email, id))) stored++;
        seen++;
      }
      pageToken = list.nextPageToken;
    } while (pageToken && seen < 200 && Date.now() < deadline);
    // Only move the window forward once everything since `since` was looked at.
    await db.from("lb_google_accounts").update({ last_sync_at: started.toISOString(), last_error: null, ...(finished && !pageToken ? { synced_until: started.toISOString() } : {}) }).eq("id", a.id);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    // Revoked access: stop trying until the user connects again.
    await db.from("lb_google_accounts").update({ last_sync_at: started.toISOString(), last_error: msg, ...(/invalid_grant/i.test(msg) ? { is_active: false } : {}) }).eq("id", a.id);
    throw e;
  }
  return { stored };
}

export async function syncAll(budgetMs = 50000) {
  const db = createAdminClient();
  const end = Date.now() + budgetMs;
  const { data } = await db.from("lb_google_accounts").select("id").eq("is_active", true).order("last_sync_at", { ascending: true, nullsFirst: true }).limit(50);
  let stored = 0, failed = 0;
  for (const a of data ?? []) {
    if (Date.now() > end - 3000) break;
    try { stored += (await syncAccount(a.id, Math.min(end, Date.now() + 15000))).stored; } catch { failed++; }
  }
  return { accounts: data?.length ?? 0, stored, failed };
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

/** Sends a plain-text mail from the user's Gmail and stores it on the lead. */
export async function sendEmail(o: { userId: string; to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null }) {
  const db = createAdminClient();
  const { data: a } = await db.from("lb_google_accounts").select("id,email,refresh_token_enc,is_active").eq("user_id", o.userId).maybeSingle();
  if (!a?.is_active) throw new Error("Connect your Gmail first (Email page).");
  const token = await accessToken(a.refresh_token_enc);
  const mime = [
    `From: ${a.email}`, `To: ${o.to}`, `Subject: ${encodeHeader(o.subject)}`, "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64",
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`] : []),
    "", Buffer.from(o.body).toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ].join("\r\n");
  const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sent = await gmail<{ id: string; threadId: string }>(token, "messages/send", { method: "POST", body: JSON.stringify({ raw, ...(o.threadId ? { threadId: o.threadId } : {}) }) });
  await ingest(db, token, a.id, a.email, sent.id);
}
