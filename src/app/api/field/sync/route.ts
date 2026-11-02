import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import { EXPENSE_CATEGORIES, FIELD_BUCKET, VISIT_OUTCOMES } from "@/lib/field";

// One entry of the field app's offline queue (src/lib/offline/queue.ts). A route handler,
// not a server action, so phones that saved entries before a new deploy can still send them.
// Replies 200 {ok:false,error} for entries the server refuses (the phone shows it and stops
// retrying), 401 when signed out, 5xx for "try again later".

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_FILE = 8 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

const geo = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), acc: z.number().min(0).max(1e6) }).nullable().optional();
const at = z.iso.datetime({ offset: true });
const id = z.uuid();
const Item = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("checkin"), client_id: id, at, geo, note: z.string().max(500).optional() }),
  z.object({ kind: z.literal("checkout"), client_id: id, at, geo, note: z.string().max(500).optional() }),
  z.object({ kind: z.literal("visit_start"), client_id: id, at, geo, lead_id: id.nullish(), customer_name: z.string().max(200).optional(), purpose: z.string().max(200).optional() }),
  z.object({ kind: z.literal("visit_end"), client_id: id, at, geo, outcome: z.enum(VISIT_OUTCOMES.map((o) => o.value)), notes: z.string().max(4000).optional(), followup_at: at.nullish(), lead_id: id.nullish() }),
  z.object({ kind: z.literal("expense"), client_id: id, date: z.iso.date(), category: z.enum(EXPENSE_CATEGORIES.map((c) => c.value)),
    amount: z.number().positive("Amount must be more than 0").max(10000000), km: z.number().min(0).max(100000).nullish(),
    description: z.string().max(1000).optional(), lead_id: id.nullish(), visit_client_id: id.nullish() }),
  z.object({ kind: z.literal("lead"), client_id: id, name: z.string().max(200).optional(), phone: z.string().min(5).max(30), notes: z.string().max(4000).optional() }),
  z.object({ kind: z.literal("note"), client_id: id, lead_id: id, body: z.string().trim().min(1, "Note is empty").max(4000) }),
]);

const ok = (message?: string) => NextResponse.json({ ok: true, message });
const refuse = (error: string) => NextResponse.json({ ok: false, error });
const missing = (m: string) => /lb_attendance|lb_field_visits|lb_expenses|schema cache/i.test(m);

export async function POST(req: Request) {
  const s = await getSession();
  if (!s?.profile) return NextResponse.json({ ok: false, error: "Signed out" }, { status: 401 });
  if (!s.entitled) return refuse("Your company's plan has expired");
  const me = s.profile;

  let fd: FormData;
  try { fd = await req.formData(); } catch { return refuse("Bad request"); }
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get("item") ?? "")); } catch { return refuse("Bad request"); }
  const p = Item.safeParse(raw);
  if (!p.success) return refuse(p.error.issues[0]?.message ?? "Invalid entry");
  const it = p.data;
  const file = fd.get("file");
  const blob = file && typeof file !== "string" && file.size > 0 ? file : null;
  if (blob && (blob.size > MAX_FILE || !FILE_TYPES[blob.type])) return refuse("Photo must be a JPG/PNG/WebP or PDF under 8 MB");

  const sb = await createClient();
  const g = "geo" in it ? it.geo ?? null : null;

  /** Upload the attached photo/receipt; returns the storage path, or null when there is none. */
  const upload = async (): Promise<string | null> => {
    if (!blob) return null;
    if (!hasServiceRole()) return null;
    const path = `${me.company_id}/${me.id}/${it.client_id}.${FILE_TYPES[blob.type]}`;
    const { error } = await createAdminClient().storage.from(FIELD_BUCKET)
      .upload(path, Buffer.from(await blob.arrayBuffer()), { contentType: blob.type, upsert: true });
    if (error) throw new Error("Photo upload failed: " + error.message);
    return path;
  };

  try {
    switch (it.kind) {
      case "checkin": {
        const { error } = await sb.from("lb_attendance").upsert({
          company_id: me.company_id, user_id: me.id, client_id: it.client_id, check_in_at: it.at,
          in_lat: g?.lat ?? null, in_lng: g?.lng ?? null, in_acc: g?.acc ?? null, in_note: (it.note ?? "").trim(),
        }, { onConflict: "user_id,client_id", ignoreDuplicates: true });
        if (error) return refuse(missing(error.message) ? "Attendance is not set up yet (database update pending)" : errMsg(error));
        return ok("Checked in");
      }
      case "checkout": {
        const { data, error } = await sb.from("lb_attendance").update({
          check_out_at: it.at, out_lat: g?.lat ?? null, out_lng: g?.lng ?? null, out_acc: g?.acc ?? null, out_note: (it.note ?? "").trim(),
        }).eq("user_id", me.id).eq("client_id", it.client_id).select("id");
        if (error) return refuse(errMsg(error));
        if (!data?.length) return refuse("Check-in for this check-out was not found");
        return ok("Checked out");
      }
      case "visit_start": {
        const { error } = await sb.from("lb_field_visits").upsert({
          company_id: me.company_id, user_id: me.id, client_id: it.client_id, started_at: it.at, lead_id: it.lead_id ?? null,
          customer_name: (it.customer_name ?? "").trim(), purpose: (it.purpose ?? "").trim(),
          start_lat: g?.lat ?? null, start_lng: g?.lng ?? null, start_acc: g?.acc ?? null,
        }, { onConflict: "user_id,client_id", ignoreDuplicates: true });
        if (error) return refuse(missing(error.message) ? "Field visits are not set up yet (database update pending)" : errMsg(error));
        return ok("Visit started");
      }
      case "visit_end": {
        const { data: v, error: e1 } = await sb.from("lb_field_visits").select("id,lead_id,ended_at,photo_path")
          .eq("user_id", me.id).eq("client_id", it.client_id).maybeSingle();
        if (e1) return refuse(errMsg(e1));
        if (!v) return refuse("The visit start was not found");
        if (v.ended_at) return ok("Visit already saved");
        const photo = v.photo_path ?? (await upload());
        const { error } = await sb.from("lb_field_visits").update({
          ended_at: it.at, end_lat: g?.lat ?? null, end_lng: g?.lng ?? null, end_acc: g?.acc ?? null,
          outcome: it.outcome, notes: (it.notes ?? "").trim(), photo_path: photo,
          ...(it.lead_id && !v.lead_id ? { lead_id: it.lead_id } : {}),
        }).eq("id", v.id);
        if (error) return refuse(errMsg(error));
        const lead = (v.lead_id as string | null) ?? it.lead_id ?? null;
        if (lead && it.followup_at && new Date(it.followup_at) > new Date()) {
          const { error: fe } = await sb.rpc("lb_add_followup", { p_lead: lead, p_due: it.followup_at, p_note: "After field visit" });
          if (fe) return ok("Visit saved, but the follow-up could not be added: " + errMsg(fe));
        }
        return ok("Visit saved");
      }
      case "expense": {
        const { data: ex, error: e0 } = await sb.from("lb_expenses").select("id").eq("user_id", me.id).eq("client_id", it.client_id).maybeSingle();
        if (e0) return refuse(missing(e0.message) ? "Expenses are not set up yet (database update pending)" : errMsg(e0));
        if (ex) return ok("Expense already saved");
        let visitId: string | null = null;
        if (it.visit_client_id) {
          const { data: v } = await sb.from("lb_field_visits").select("id").eq("user_id", me.id).eq("client_id", it.visit_client_id).maybeSingle();
          visitId = (v?.id as string | undefined) ?? null;
        }
        const receipt = await upload();
        const { error } = await sb.from("lb_expenses").upsert({
          company_id: me.company_id, user_id: me.id, client_id: it.client_id, expense_date: it.date, category: it.category,
          amount: Math.round(it.amount * 100) / 100, km: it.km ?? null, description: (it.description ?? "").trim(),
          lead_id: it.lead_id ?? null, visit_id: visitId, receipt_path: receipt,
        }, { onConflict: "user_id,client_id", ignoreDuplicates: true });
        if (error) return refuse(errMsg(error));
        return ok("Expense sent for approval");
      }
      case "lead": {
        const phone = normalizePhone(it.phone);
        if (!phone) return refuse("Invalid mobile number: " + it.phone);
        const { data, error } = await sb.rpc("lb_create_lead", {
          p: { name: (it.name ?? "").trim(), email: "", location: "", branch_id: "", department_id: "", team_id: "", product_id: "", source_id: "",
            priority: "normal", expected_value: "", notes: (it.notes ?? "").trim(), owner_id: "", tag_ids: [], next_followup_at: "",
            phone_e164: phone, force_repeat: false },
        });
        if (error) return refuse(errMsg(error));
        if (data?.status === "duplicate") return ok(`Number already has lead LB-${data.lead_no}`);
        return ok("Lead added");
      }
      case "note": {
        const { error } = await sb.rpc("lb_log_activity", { p_lead: it.lead_id, p_type: "note", p_body: it.body });
        if (error) return refuse(errMsg(error));
        return ok("Note saved");
      }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, { status: 503 });
  }
}
