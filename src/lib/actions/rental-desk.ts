"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { drainOutbox } from "@/lib/outbox";
import { drainAlerts } from "@/lib/alerts";
import { errMsg, normalizePhone } from "@/lib/util";
import { LIVORA_ZONES, MSG, type Zone } from "@/lib/rental-desk";
import { queueFinalAlert, send } from "@/lib/rental-desk-server";
import type { FormState } from "@/components/ui";

// Rental desk admin actions (lb_rental_desk / lb_rental_enquiries, SQL 20261111000000).

const tpl = z.string().trim().max(120).regex(/^[a-z0-9_]*$/, "Template name: lowercase letters, digits and _ only").default("");
const Settings = z.object({
  fee: z.coerce.number().int().min(1).max(100000),
  upi_id: z.string().trim().max(120).default(""),
  upi_name: z.string().trim().max(120).default(""),
  qr_url: z.union([z.literal(""), z.string().trim().url().startsWith("https://")]).default(""),
  alert_phone: z.string().trim().max(20).default(""),
  alert_template: tpl, alert_template_lang: z.string().trim().max(15).default("en"),
  followup_template: tpl, followup_template_lang: z.string().trim().max(15).default("en"),
  min_followup_budget: z.coerce.number().int().min(0).max(10000000),
  followup_hours: z.coerce.number().int().min(6).max(168),
  max_followups: z.coerce.number().int().min(0).max(365),
  max_followups_unreg: z.coerce.number().int().min(0).max(365),
});

export async function saveRentalDesk(_: FormState, fd: FormData): Promise<FormState> {
  const { profile } = await requireAdmin();
  const p = Settings.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form" };
  const phone = p.data.alert_phone ? normalizePhone(p.data.alert_phone) : null;
  if (p.data.alert_phone && !phone) return { error: "Personal number: enter a valid mobile number" };
  const sb = await createClient();
  const { data: cur } = await sb.from("lb_rental_desk").select("zones").eq("company_id", profile.company_id).maybeSingle();
  const base: Zone[] = Array.isArray(cur?.zones) && cur.zones.length ? cur.zones : LIVORA_ZONES.map((z) => ({ ...z, user_id: null }));
  const zones = base.map((z) => ({
    ...z,
    user_id: String(fd.get(`zone_user_${z.no}`) ?? "") || null,
    areas: String(fd.get(`zone_areas_${z.no}`) ?? z.areas.join(", ")).split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 200),
  }));

  // New QR photo: stored in the public brand bucket so WhatsApp can fetch it.
  let qr = p.data.qr_url;
  const file = fd.get("qr_file");
  if (file instanceof File && file.size > 0) {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return { error: "QR photo: PNG or JPG only" };
    if (file.size > 4 * 1024 * 1024) return { error: "QR photo: max 4 MB" };
    const db = createAdminClient();
    const path = `rental/${profile.company_id}/qr-${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
    const { error } = await db.storage.from("lb-brand").upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { error: `QR upload failed: ${error.message}` };
    qr = db.storage.from("lb-brand").getPublicUrl(path).data.publicUrl;
  }

  const { error } = await sb.from("lb_rental_desk").upsert({
    company_id: profile.company_id, enabled: fd.get("enabled") === "on", fee: p.data.fee, upi_id: p.data.upi_id, upi_name: p.data.upi_name,
    qr_url: qr, alert_phone: phone, alert_template: p.data.alert_template || null, alert_template_lang: p.data.alert_template_lang || "en",
    followup_template: p.data.followup_template || null, followup_template_lang: p.data.followup_template_lang || "en",
    min_followup_budget: p.data.min_followup_budget, followup_hours: p.data.followup_hours, max_followups: p.data.max_followups,
    max_followups_unreg: p.data.max_followups_unreg, zones, updated_at: new Date().toISOString(), updated_by: profile.id,
  }, { onConflict: "company_id" });
  if (error) return { error: errMsg(error) };
  revalidatePath("/rental-desk");
  return { ok: "Rental desk saved." };
}

async function enquiry(id: string) {
  const sb = await createClient();
  const { data } = await sb.from("lb_rental_enquiries").select("id,company_id,conversation_id,zone").eq("id", id).maybeSingle();
  return data;
}

const Id = z.uuid();

export async function confirmRentalPayment(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Id.safeParse(fd.get("id"));
  if (!id.success) return { error: "Bad enquiry" };
  const zone = Number(fd.get("zone")) || null;
  const sb = await createClient();
  const { data, error } = await sb.rpc("lb_rental_confirm_payment", { p_id: id.data, p_zone: zone });
  if (error) return { error: errMsg(error) };
  const e = await enquiry(id.data);
  const r = data as { zone: number; zone_name: string; user_name: string };
  if (e) {
    const db = createAdminClient();
    await send(db, { messageId: `confirm:${e.id}`, conversationId: e.conversation_id, companyId: e.company_id },
      { kind: "text", body: MSG.registered(`Zone ${r.zone}: ${r.zone_name}`) }, 0, "paid").catch(() => {});
    await drainOutbox(8000).catch(() => {});
  }
  revalidatePath("/rental-desk");
  return { ok: `Payment confirmed. Lead given to ${r.user_name} (Zone ${r.zone}); the customer got the confirmation.` };
}

export async function rejectRentalPayment(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Id.safeParse(fd.get("id"));
  if (!id.success) return { error: "Bad enquiry" };
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 200);
  const sb = await createClient();
  const { error } = await sb.rpc("lb_rental_reject_payment", { p_id: id.data, p_reason: reason || null });
  if (error) return { error: errMsg(error) };
  const e = await enquiry(id.data);
  if (e) {
    await send(createAdminClient(), { messageId: `reject:${e.id}:${Date.now()}`, conversationId: e.conversation_id, companyId: e.company_id },
      { kind: "text", body: MSG.paymentRejected(reason) }, 0, "reject").catch(() => {});
    await drainOutbox(8000).catch(() => {});
  }
  revalidatePath("/rental-desk");
  return { ok: "Customer asked to send the screenshot again." };
}

export async function setRentalZone(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Id.safeParse(fd.get("id"));
  if (!id.success) return { error: "Bad enquiry" };
  const sb = await createClient();
  const { error } = await sb.rpc("lb_rental_set_zone", { p_id: id.data, p_zone: Number(fd.get("zone")) || null });
  if (error) return { error: errMsg(error) };
  revalidatePath("/rental-desk");
  return { ok: "Zone saved." };
}

export async function markRentalFound(_: FormState, fd: FormData): Promise<FormState> {
  const { profile } = await requireAdmin();
  const id = Id.safeParse(fd.get("id"));
  if (!id.success) return { error: "Bad enquiry" };
  const broker = String(fd.get("broker") ?? "").trim(), rent = String(fd.get("rent") ?? "").trim();
  if (!broker || !rent) return { error: "Enter who gave the flat and the final rent" };
  const sb = await createClient();
  const { data, error } = await sb.rpc("lb_rental_mark_found", { p_id: id.data, p_broker: broker, p_rent: rent });
  if (error) return { error: errMsg(error) };
  if ((data as { registered: boolean }).registered) {
    const db = createAdminClient();
    const { data: d } = await db.from("lb_rental_desk").select("alert_phone").eq("company_id", profile.company_id).maybeSingle();
    await queueFinalAlert(db, profile.company_id, id.data, d?.alert_phone ?? null, `final-admin:${id.data}`);
    await drainAlerts(8000).catch(() => {});
  }
  revalidatePath("/rental-desk");
  return { ok: "Saved as flat final." };
}
