"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { encryptSecret, errMsg } from "@/lib/util";
import { demoBlocked } from "@/lib/demo";
import { ensureMeeting, testZoom } from "@/lib/meetings";

type FormState = { error?: string; ok?: string } | undefined;
const NOT_READY = "Meeting links are not set up yet: run the meeting links SQL once in Supabase.";
const fail = (e: unknown): FormState => { const m = errMsg(e); return { error: /meeting_|lb_meeting_accounts|schema cache/i.test(m) ? NOT_READY : m }; };

async function admin() {
  const { profile } = await requireAdmin();
  const demo = await demoBlocked(profile.company_id);
  if (demo) throw new Error(demo);
  if (!hasServiceRole() || !process.env.LB_SECRETS_KEY) throw new Error("Server is not configured: SUPABASE_SERVICE_ROLE_KEY / LB_SECRETS_KEY missing.");
  return { me: profile, db: createAdminClient() };
}

/** Which link appointments get: none / zoom / google / fixed. */
export async function saveMeetingMode(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({
    mode: z.enum(["none", "zoom", "google", "fixed"]),
    fixed_url: z.string().trim().max(500).optional().transform((v) => v || null),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  if (p.data.mode === "fixed" && !/^https:\/\/\S+$/.test(p.data.fixed_url ?? "")) return { error: "Paste the meeting link (starting with https://)." };
  try {
    const { me, db } = await admin();
    if (p.data.mode === "zoom" || p.data.mode === "google") {
      const { data: acc } = await db.from("lb_meeting_accounts").select("zoom_client_secret_enc,google_refresh_enc").eq("company_id", me.company_id).maybeSingle();
      if (p.data.mode === "zoom" && !acc?.zoom_client_secret_enc) return { error: "Save the Zoom app keys first." };
      if (p.data.mode === "google" && !acc?.google_refresh_enc) return { error: "Connect Google first." };
    }
    const { error } = await db.from("lb_care_settings").upsert({ company_id: me.company_id, meeting_mode: p.data.mode, meeting_fixed_url: p.data.fixed_url }, { onConflict: "company_id" });
    if (error) return fail(error);
    revalidatePath("/care", "layout");
    return { ok: p.data.mode === "none" ? "Meeting links turned off." : "Saved. New appointments will get a meeting link." };
  } catch (e) { return fail(e); }
}

/** Zoom Server-to-Server OAuth app keys (tested before saving). */
export async function saveZoomKeys(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({
    account_id: z.string().trim().min(5, "Account ID required").max(100),
    client_id: z.string().trim().min(5, "Client ID required").max(100),
    client_secret: z.string().trim().min(5, "Client secret required").max(200),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  try {
    const { me, db } = await admin();
    const who = await testZoom(p.data.account_id, p.data.client_id, p.data.client_secret);
    const { error } = await db.from("lb_meeting_accounts").upsert({
      company_id: me.company_id, zoom_account_id: p.data.account_id, zoom_client_id: p.data.client_id,
      zoom_client_secret_enc: encryptSecret(p.data.client_secret), updated_by: me.id, updated_at: new Date().toISOString(),
    }, { onConflict: "company_id" });
    if (error) return fail(error);
    revalidatePath("/care/meetings");
    return { ok: `Zoom connected (${who}).` };
  } catch (e) { return fail(e); }
}

export async function disconnectMeetings(which: "zoom" | "google"): Promise<FormState> {
  try {
    const { me, db } = await admin();
    const patch = which === "zoom" ? { zoom_account_id: null, zoom_client_id: null, zoom_client_secret_enc: null } : { google_email: null, google_refresh_enc: null };
    const { error } = await db.from("lb_meeting_accounts").update({ ...patch, updated_at: new Date().toISOString() }).eq("company_id", me.company_id);
    if (error) return fail(error);
    await db.from("lb_care_settings").update({ meeting_mode: "none" }).eq("company_id", me.company_id).eq("meeting_mode", which);
    revalidatePath("/care", "layout");
    return { ok: "Disconnected." };
  } catch (e) { return fail(e); }
}

export async function saveGoogleCalendar(_: FormState, form: FormData): Promise<FormState> {
  const cal = String(form.get("calendar_id") ?? "").trim() || "primary";
  if (cal.length > 200) return { error: "Calendar ID too long" };
  try {
    const { me, db } = await admin();
    const { error } = await db.from("lb_meeting_accounts").update({ google_calendar_id: cal, updated_at: new Date().toISOString() }).eq("company_id", me.company_id);
    if (error) return fail(error);
    revalidatePath("/care/meetings");
    return { ok: "Calendar saved." };
  } catch (e) { return fail(e); }
}

/** Create (or retry) the meeting link of one appointment the user can see. */
export async function makeMeetingLink(apptId: string): Promise<FormState & { url?: string }> {
  await requireProfile();
  if (!z.uuid().safeParse(apptId).success) return { error: "Invalid appointment" };
  const { data } = await (await createClient()).from("lb_appointments").select("id").eq("id", apptId).maybeSingle();
  if (!data) return { error: "Appointment not found" };
  const r = await ensureMeeting(apptId, { retry: true });
  if (!r) return { error: "Meeting links are off. An admin can turn them on in Customer care → Meeting links." };
  if (r.error) return { error: r.error };
  revalidatePath("/care/appointments");
  return { ok: "Meeting link ready.", url: r.url };
}
