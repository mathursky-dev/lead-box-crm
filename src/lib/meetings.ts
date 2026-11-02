import "server-only";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { decryptSecret } from "./util";

// Video meeting links for appointments: Zoom (Server-to-Server OAuth app), Google Meet
// (a connected Google account's calendar) or one fixed link the company always uses.

export type MeetingMode = "none" | "zoom" | "google" | "fixed";
export const GOOGLE_MEET_SCOPES = "openid email https://www.googleapis.com/auth/calendar.events";

type Db = ReturnType<typeof createAdminClient>;
type Appt = { id: string; company_id: string; appt_no: number; starts_at: string; ends_at: string; name: string | null; phone_e164: string; note: string | null; meeting_url: string | null };

const timeout = () => AbortSignal.timeout(15000);

async function zoomToken(accountId: string, clientId: string, secret: string) {
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}` }, signal: timeout(), cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; reason?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Zoom login failed: ${j.reason ?? j.error ?? r.status}`);
  return j.access_token;
}

export async function testZoom(accountId: string, clientId: string, secret: string) {
  const token = await zoomToken(accountId, clientId, secret);
  const r = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${token}` }, signal: timeout(), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { email?: string; message?: string };
  if (!r.ok) throw new Error(`Zoom: ${j.message ?? r.status} (add the meeting:write and user:read scopes to the app)`);
  return j.email ?? "Zoom account";
}

/** Google access token from the stored refresh token. */
export async function googleAccess(refreshToken: string) {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Google sign-in is not set up on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refreshToken, grant_type: "refresh_token" }), signal: timeout(), cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google: ${j.error_description ?? j.error ?? r.status}. Connect Google again.`);
  return j.access_token;
}

async function createMeeting(db: Db, a: Appt, mode: MeetingMode, fixedUrl: string | null, companyName: string): Promise<{ url: string; provider: string; ext?: string }> {
  const topic = `${companyName}: appointment #${a.appt_no}${a.name ? ` with ${a.name}` : ""}`.slice(0, 190);
  const minutes = Math.max(5, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000));
  if (mode === "fixed") {
    if (!fixedUrl) throw new Error("No fixed meeting link saved.");
    return { url: fixedUrl, provider: "fixed" };
  }
  const { data: acc } = await db.from("lb_meeting_accounts").select("*").eq("company_id", a.company_id).maybeSingle();
  if (mode === "zoom") {
    if (!acc?.zoom_account_id || !acc.zoom_client_id || !acc.zoom_client_secret_enc) throw new Error("Zoom is not connected.");
    const token = await zoomToken(acc.zoom_account_id, acc.zoom_client_id, decryptSecret(acc.zoom_client_secret_enc));
    const r = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: timeout(), cache: "no-store",
      body: JSON.stringify({ topic, type: 2, start_time: new Date(a.starts_at).toISOString().replace(/\.\d{3}Z$/, "Z"), duration: minutes, timezone: "Asia/Kolkata",
        agenda: a.note ?? undefined, settings: { join_before_host: true, waiting_room: false } }),
    });
    const j = (await r.json().catch(() => ({}))) as { join_url?: string; id?: number | string; message?: string };
    if (!r.ok || !j.join_url) throw new Error(`Zoom: ${j.message ?? r.status}`);
    return { url: j.join_url, provider: "zoom", ext: String(j.id ?? "") };
  }
  if (mode === "google") {
    if (!acc?.google_refresh_enc) throw new Error("Google is not connected.");
    const token = await googleAccess(decryptSecret(acc.google_refresh_enc));
    const cal = encodeURIComponent(acc.google_calendar_id || "primary");
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events?conferenceDataVersion=1`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: timeout(), cache: "no-store",
      body: JSON.stringify({
        summary: topic, description: [a.name, a.phone_e164, a.note].filter(Boolean).join("\n"),
        start: { dateTime: new Date(a.starts_at).toISOString() }, end: { dateTime: new Date(a.ends_at).toISOString() },
        conferenceData: { createRequest: { requestId: a.id, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { hangoutLink?: string; id?: string; error?: { message?: string } };
    if (!r.ok || !j.hangoutLink) throw new Error(`Google Calendar: ${j.error?.message ?? (r.ok ? "no Meet link returned" : r.status)}`);
    return { url: j.hangoutLink, provider: "google", ext: j.id };
  }
  throw new Error("Meeting links are off.");
}

/**
 * Meeting link of an appointment, created on first call. Returns null when the company has
 * meeting links off (or the SQL is not applied yet). Errors are saved on the appointment.
 */
export async function ensureMeeting(apptId: string, { retry = false } = {}): Promise<{ url?: string; error?: string } | null> {
  if (!hasServiceRole()) return null;
  const db = createAdminClient();
  const { data: a, error } = await db.from("lb_appointments").select("id,company_id,appt_no,starts_at,ends_at,name,phone_e164,note,meeting_url,meeting_error,status").eq("id", apptId).maybeSingle();
  if (error || !a) return null;
  if (a.meeting_url) return { url: a.meeting_url as string };
  if (a.meeting_error && !retry) return { error: a.meeting_error as string };
  const [{ data: s }, { data: co }] = await Promise.all([
    db.from("lb_care_settings").select("meeting_mode,meeting_fixed_url").eq("company_id", a.company_id).maybeSingle(),
    db.from("lb_companies").select("name").eq("id", a.company_id).maybeSingle(),
  ]);
  const mode = (s?.meeting_mode ?? "none") as MeetingMode;
  if (mode === "none") return null;
  try {
    const m = await createMeeting(db, a as Appt, mode, (s?.meeting_fixed_url as string) ?? null, (co?.name as string) ?? "Meeting");
    await db.from("lb_appointments").update({ meeting_url: m.url, meeting_provider: m.provider, meeting_ext_id: m.ext ?? null, meeting_error: null, updated_at: new Date().toISOString() }).eq("id", a.id);
    return { url: m.url };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await db.from("lb_appointments").update({ meeting_error: msg }).eq("id", a.id);
    return { error: msg };
  }
}

/** Jobs runner: upcoming appointments still without a link (e.g. booked online). */
export async function fillMissingMeetings(limit = 5) {
  if (!hasServiceRole()) return 0;
  const db = createAdminClient();
  const { data, error } = await db.from("lb_appointments").select("id,company_id").is("meeting_url", null).is("meeting_error", null)
    .in("status", ["booked", "confirmed"]).gt("starts_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(50);
  if (error || !data?.length) return 0;
  const cos = [...new Set(data.map((d) => d.company_id as string))];
  const { data: on } = await db.from("lb_care_settings").select("company_id").in("company_id", cos).neq("meeting_mode", "none");
  const allowed = new Set((on ?? []).map((r) => r.company_id as string));
  let n = 0;
  for (const a of data.filter((d) => allowed.has(d.company_id as string)).slice(0, limit)) {
    const r = await ensureMeeting(a.id as string);
    if (r?.url) n++;
  }
  return n;
}
