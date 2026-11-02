"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import { CALL_OUTCOMES, type DeviceCall } from "@/lib/calls";

// Call tracking. The Android app reads the phone's call log (or, in the Play Store
// "lite" build, the calls started from the CRM) and the page hands them to syncDeviceCalls.
// lb_save_calls keeps only numbers that are CRM customers of the caller's company.

const BUCKET = "lb-calls";
const MAX_REC_MB = 50;
const AUDIO_EXT = new Set(["m4a", "mp3", "aac", "amr", "3gp", "ogg", "opus", "wav", "awb"]);
const DIRECTIONS = new Set(["outgoing", "incoming", "missed", "rejected"]);

export type SyncResult = {
  error?: string;
  saved?: { key: string; id: string; lead_id: string | null; status: string }[];
  /** Company allows recordings to be uploaded. */
  recordings?: boolean;
  /** Most recent outgoing call just saved on a lead, for the "how did it go?" popup. */
  prompt?: { id: string; lead_id: string; lead_no: number; name: string; duration: number } | null;
};

export async function syncDeviceCalls(calls: DeviceCall[]): Promise<SyncResult> {
  const { profile } = await requireProfile();
  if (!Array.isArray(calls) || calls.length === 0) return { saved: [] };
  const rows = calls.slice(0, 200).flatMap((c) => {
    const phone = normalizePhone(String(c?.number ?? ""), "IN");
    const at = Number(c?.startedAt);
    if (!phone || !Number.isFinite(at) || !DIRECTIONS.has(String(c?.direction))) return [];
    return [{ key: String(c.key).slice(0, 120), phone, direction: c.direction, started_at: new Date(at).toISOString(),
      duration: Math.max(0, Math.round(Number(c.duration) || 0)), source: c.source === "app_lite" ? "app_lite" : "app" }];
  });
  if (!rows.length) return { saved: [] };
  const sb = await createClient();
  const { data, error } = await sb.rpc("lb_save_calls", { p_calls: rows });
  if (error) return { error: /lb_save_calls|schema cache/i.test(error.message) ? "Call tracking is not set up yet (database update pending)." : errMsg(error) };
  const saved = (data ?? []) as { key: string; id: string; lead_id: string | null; status: string }[];
  const { data: co } = await sb.from("lb_companies").select("call_recordings").eq("id", profile.company_id).maybeSingle();

  // Popup for the latest outgoing call (last 20 min) that was just saved on a lead.
  let prompt: SyncResult["prompt"] = null;
  const fresh = saved.filter((s) => s.status === "saved" && s.lead_id)
    .map((s) => ({ s, r: rows.find((r) => r.key === s.key)! }))
    .filter(({ r }) => r.direction === "outgoing" && Date.now() - new Date(r.started_at).getTime() < 20 * 60000)
    .sort((a, b) => b.r.started_at.localeCompare(a.r.started_at))[0];
  if (fresh) {
    const { data: l } = await sb.from("lb_leads").select("id,lead_no,customer:lb_customers(name,phone_e164)").eq("id", fresh.s.lead_id!).maybeSingle();
    const cu = l?.customer as unknown as { name: string | null; phone_e164: string } | null;
    if (l) prompt = { id: fresh.s.id, lead_id: l.id, lead_no: l.lead_no as number, name: cu?.name || cu?.phone_e164 || "", duration: fresh.r.duration };
  }
  if (saved.some((s) => s.status === "saved")) revalidatePath("/calls");
  return { saved, recordings: co?.call_recordings !== false, prompt };
}

async function myCall(id: string) {
  const { profile } = await requireProfile();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid call" } as const;
  const { data } = await createAdminClient().from("lb_calls").select("id,user_id,lead_id,company_id,recording_path")
    .eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!data) return { error: "Call not found" } as const;
  return { profile, call: data };
}

/** Step 1 of a recording upload: a one-time URL the app PUTs the audio file to. */
export async function startRecordingUpload(callId: string, fileName: string, size: number): Promise<{ error?: string; url?: string; path?: string }> {
  if (!hasServiceRole()) return { error: "Server not configured for uploads" };
  const o = await myCall(callId);
  if ("error" in o) return { error: o.error };
  if (o.call.user_id !== o.profile.id) return { error: "Only the person who made the call can upload its recording" };
  if (o.call.recording_path) return { error: "Recording already uploaded" };
  const { data: co } = await createAdminClient().from("lb_companies").select("call_recordings").eq("id", o.profile.company_id).maybeSingle();
  if (co?.call_recordings === false) return { error: "Recordings are turned off for your company" };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_REC_MB * 1024 * 1024) return { error: `Recording must be under ${MAX_REC_MB} MB` };
  const ext = String(fileName).split(".").pop()?.toLowerCase() ?? "";
  if (!AUDIO_EXT.has(ext)) return { error: "Not an audio file" };
  const path = `${o.profile.company_id}/${o.call.id}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return { error: `Upload failed: ${error?.message ?? "no URL"}` };
  return { url: data.signedUrl, path };
}

/** Step 2: link the uploaded file to the call. */
export async function attachRecording(callId: string): Promise<{ error?: string; ok?: boolean }> {
  const o = await myCall(callId);
  if ("error" in o) return { error: o.error };
  if (o.call.user_id !== o.profile.id) return { error: "Not your call" };
  const st = createAdminClient().storage.from(BUCKET);
  const { data: files } = await st.list(o.profile.company_id, { search: o.call.id, limit: 5 });
  const f = (files ?? []).find((x) => x.name.startsWith(`${o.call.id}.`));
  if (!f) return { error: "Recording not found" };
  const size = Number(f.metadata?.size ?? 0);
  const path = `${o.profile.company_id}/${f.name}`;
  if (size > MAX_REC_MB * 1024 * 1024) { await st.remove([path]); return { error: "Recording too big" }; }
  const { error } = await createAdminClient().from("lb_calls").update({
    recording_path: path, recording_size: size, recording_mime: String(f.metadata?.mimetype ?? "audio/mp4"), updated_at: new Date().toISOString(),
  }).eq("id", o.call.id);
  if (error) return { error: errMsg(error) };
  if (o.call.lead_id) revalidatePath(`/leads/${o.call.lead_id}`);
  return { ok: true };
}

/** Outcome + note after a call (the caller, or an admin). */
export async function saveCallOutcome(callId: string, outcome: string, note: string): Promise<{ error?: string; ok?: boolean }> {
  const o = await myCall(callId);
  if ("error" in o) return { error: o.error };
  if (o.call.user_id !== o.profile.id && !isAdmin(o.profile)) return { error: "Only the caller or an admin can edit this call" };
  const oc = CALL_OUTCOMES.some((x) => x.value === outcome) ? outcome : null;
  const { error } = await createAdminClient().from("lb_calls").update({ outcome: oc, note: String(note ?? "").trim().slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", o.call.id);
  if (error) return { error: errMsg(error) };
  if (o.call.lead_id) revalidatePath(`/leads/${o.call.lead_id}`);
  revalidatePath("/calls");
  return { ok: true };
}

/** Short-lived link to play a recording (RLS decides who may see the call). */
export async function callRecordingUrl(callId: string): Promise<{ error?: string; url?: string }> {
  await requireProfile();
  if (!z.uuid().safeParse(callId).success) return { error: "Invalid call" };
  const { data } = await (await createClient()).from("lb_calls").select("recording_path").eq("id", callId).maybeSingle();
  if (!data?.recording_path) return { error: "No recording" };
  const { data: s, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(data.recording_path, 3600);
  if (error || !s) return { error: "Could not open the recording" };
  return { url: s.signedUrl };
}

/** Company switch: allow call recordings to be uploaded (admins). */
export async function setCallRecordings(enabled: boolean): Promise<{ error?: string; ok?: boolean }> {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return { error: "Admins only" };
  const { error } = await createAdminClient().from("lb_companies").update({ call_recordings: Boolean(enabled) }).eq("id", profile.company_id);
  if (error) return { error: errMsg(error) };
  revalidatePath("/calls");
  return { ok: true };
}
