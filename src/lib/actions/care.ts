"use server";
import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pageBlocked, requireAdmin, requireProfile, can, type Profile } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import { enqueue } from "@/lib/inbox-send";
import { openLeadChat } from "@/lib/actions/leads";
import { DAYS, fillTemplate, type WeekHours } from "@/lib/care";
import { leadCareLinks } from "@/lib/care-server";

// Customer care (portal, appointments, feedback / NPS, referrals). Settings writes use the service role pinned
// to the admin's active company; lead-level writes check (with the user's own RLS) that the lead is visible first,
// or go through RPCs that check it themselves.

type FormState = { error?: string; ok?: string } | undefined;
type Db = ReturnType<typeof createAdminClient>;
const Uuid = z.uuid();
const on = z.string().optional().transform((v) => v === "on");
const NOT_READY = "Customer care is not set up yet: run the Customer care SQL once in Supabase.";
const notReady = (m: string) => /lb_care|lb_appointments|lb_feedback|lb_referrals|lb_customer_links|lb_staff_book|lb_set_appointment|lb_add_referral|lb_set_referral|schema cache|portal_token/i.test(m);
const fail = (e: unknown): FormState => { const m = errMsg(e); return { error: notReady(m) ? NOT_READY : m }; };

async function audit(db: Db, me: Profile, action: string, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action, entity: "care", entity_id: null, data });
}
const touch = (leadId?: string) => {
  revalidatePath("/care", "layout");
  if (leadId) revalidatePath(`/leads/${leadId}`);
};

export async function newBookingCode() { return randomBytes(6).toString("base64").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6).padEnd(6, "X"); }

// ------------------------------------------------------------- settings
export async function saveCareSettings(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!hasServiceRole()) return { error: "The server is not configured (service role key)." };
  const section = String(form.get("section") ?? "");
  const f = Object.fromEntries(form);
  const db = createAdminClient();
  let row: Record<string, unknown>;
  const src = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);

  if (section === "portal") {
    const p = z.object({ portal_enabled: on, portal_note: z.string().trim().max(500).default("") }).safeParse(f);
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
    row = p.data;
  } else if (section === "booking") {
    const p = z.object({
      booking_enabled: on,
      booking_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/, "Link code: 4–12 letters/digits"),
      booking_title: z.string().trim().min(1, "Title is required").max(80),
      booking_intro: z.string().trim().max(500).default(""),
      booking_location: z.string().trim().max(200).default(""),
      booking_thank_you: z.string().trim().max(300).default(""),
      slot_minutes: z.coerce.number().int().min(10, "Slot: 10–480 minutes").max(480, "Slot: 10–480 minutes"),
      slot_capacity: z.coerce.number().int().min(1, "Bookings per slot: 1–50").max(50, "Bookings per slot: 1–50"),
      days_ahead: z.coerce.number().int().min(1, "Days ahead: 1–90").max(90, "Days ahead: 1–90"),
      min_notice_hours: z.coerce.number().int().min(0).max(168, "Minimum notice: up to 168 hours"),
      closed_dates: z.string().trim().max(2000).default(""),
      booking_source_id: src,
    }).safeParse(f);
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
    const hours: WeekHours = {};
    for (const d of DAYS) {
      if (form.get(`day_${d.key}`) !== "on") continue;
      const a = String(form.get(`from_${d.key}`) ?? ""), b = String(form.get(`to_${d.key}`) ?? "");
      if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) return { error: `${d.label}: set both opening and closing time` };
      if (a >= b) return { error: `${d.label}: closing time must be after opening time` };
      hours[d.key] = [a, b];
    }
    if (p.data.booking_enabled && !Object.keys(hours).length) return { error: "Open at least one day of the week." };
    const closed = [...new Set(p.data.closed_dates.split(/[\s,]+/).filter(Boolean))];
    if (closed.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) return { error: "Holidays: dates as YYYY-MM-DD, separated by commas" };
    if (p.data.booking_source_id && !(await db.from("lb_sources").select("id").eq("id", p.data.booking_source_id).eq("company_id", me.company_id).maybeSingle()).data)
      return { error: "Invalid source" };
    row = { ...p.data, week_hours: hours, closed_dates: closed.slice(0, 100),
      booking_thank_you: p.data.booking_thank_you || "Your appointment is booked. We will confirm it on WhatsApp." };
  } else if (section === "feedback") {
    const p = z.object({
      feedback_auto: on,
      feedback_delay_hours: z.coerce.number().int().min(0).max(720, "Delay: up to 720 hours"),
      feedback_question: z.string().trim().min(1, "Question is required").max(200),
      feedback_message: z.string().trim().min(1, "Message is required").max(1000),
      review_url: z.string().trim().max(500).refine((v) => !v || /^https:\/\/\S+$/.test(v), "Review link must start with https://").transform((v) => v || null),
    }).safeParse(f);
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
    row = p.data;
  } else if (section === "referral") {
    const p = z.object({
      referral_enabled: on,
      referral_reward: z.string().trim().max(300).default(""),
      referral_message: z.string().trim().min(1, "Message is required").max(1000),
      referral_source_id: src,
    }).safeParse(f);
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
    if (p.data.referral_source_id && !(await db.from("lb_sources").select("id").eq("id", p.data.referral_source_id).eq("company_id", me.company_id).maybeSingle()).data)
      return { error: "Invalid source" };
    row = p.data;
  } else return { error: "Unknown section" };

  const { error } = await db.from("lb_care_settings").upsert({ ...row, company_id: me.company_id, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return error.code === "23505" ? { error: "That link code is taken, generate another." } : fail(error);
  await audit(db, me, `care.settings.${section}`, { enabled: row.portal_enabled ?? row.booking_enabled ?? row.feedback_auto ?? row.referral_enabled });
  touch();
  return { ok: "Saved." };
}

// ----------------------------------------------------- lead-level links
async function visibleLead(leadId: string) {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(leadId).success) return { error: "Invalid lead" } as const;
  if (!hasServiceRole()) return { error: "The server is not configured (service role key)." } as const;
  const { data: lead } = await (await createClient()).from("lb_leads").select("id,company_id,customer_id,lead_no,customer:lb_customers(name)")
    .eq("id", leadId).eq("company_id", profile.company_id).maybeSingle();
  if (!lead) return { error: "Lead not found" } as const;
  return { profile, lead: { ...lead, name: (lead.customer as unknown as { name: string | null } | null)?.name ?? null } };
}

async function sendText(leadId: string, body: string): Promise<{ error?: string }> {
  const chat = await openLeadChat(leadId);
  if (chat.error || !chat.id) return { error: chat.error ?? "No WhatsApp chat for this lead." };
  const r = await enqueue(chat.id, randomUUID(), { type: "text", body: body.slice(0, 4096) });
  if (r.error && !r.ok) return { error: /24-hour/.test(r.error) ? "WhatsApp 24-hour window is closed, so it wasn't sent. Copy the link and send it with a template." : r.error };
  return {};
}

/** Creates (or re-opens) the feedback request of a lead. Returns its link. */
export async function createFeedbackLink(leadId: string): Promise<{ error?: string; url?: string }> {
  const v = await visibleLead(leadId);
  if ("error" in v) return { error: v.error };
  const db = createAdminClient();
  const { data: ex, error: e1 } = await db.from("lb_feedback").select("id,status").eq("lead_id", v.lead.id).maybeSingle();
  if (e1) return fail(e1) ?? {};
  if (!ex) {
    const { error } = await db.from("lb_feedback").insert({ company_id: v.profile.company_id, lead_id: v.lead.id, customer_id: v.lead.customer_id, requested_by: v.profile.id });
    if (error && error.code !== "23505") return fail(error) ?? {};
  } else if (ex.status === "pending" || ex.status === "not_sent") {
    await db.from("lb_feedback").update({ send_after: null, status: "pending", requested_by: v.profile.id }).eq("id", ex.id);
  }
  const links = await leadCareLinks(v.profile.company_id, v.lead.customer_id, v.lead.id);
  touch(v.lead.id);
  return links?.feedback ? { url: links.feedback.url } : { error: NOT_READY };
}

/** Sends the portal / booking / feedback / referral link in the lead's WhatsApp chat. */
export async function sendCareLink(leadId: string, kind: "portal" | "booking" | "feedback" | "referral"): Promise<FormState & { url?: string }> {
  const v = await visibleLead(leadId);
  if ("error" in v) return { error: v.error };
  if (!can(v.profile, "chats.send")) return { error: "You don't have permission to send WhatsApp messages." };
  if (kind === "feedback") { const r = await createFeedbackLink(leadId); if (r.error) return { error: r.error }; }
  const links = await leadCareLinks(v.profile.company_id, v.lead.customer_id, v.lead.id);
  if (!links) return { error: NOT_READY };
  const { data: co } = await createAdminClient().from("lb_companies").select("name").eq("id", v.profile.company_id).maybeSingle();
  const company = (co?.name as string | undefined) ?? "";
  const s = links.settings;
  const url = kind === "feedback" ? links.feedback?.url : links[kind];
  if (!url) return { error: kind === "booking" ? "Turn on the booking page first: Customer care → Settings." : kind === "portal" ? "The customer portal is turned off in Customer care → Settings." : kind === "referral" ? "The referral program is turned off in Customer care → Settings." : NOT_READY };
  const tpl = {
    portal: `Hi {name}, you can see your quotations, invoices, orders and appointments with {company} here anytime: {link}`,
    booking: `Hi {name}, please pick a convenient time for your appointment with {company} here: {link}`,
    feedback: s.feedback_message,
    referral: s.referral_message + (s.referral_reward ? `\n🎁 ${s.referral_reward}` : ""),
  }[kind];
  const r = await sendText(v.lead.id, fillTemplate(tpl, { name: v.lead.name, company, link: url }));
  if (r.error) return { error: r.error, url };
  if (kind === "feedback") {
    await createAdminClient().from("lb_feedback").update({ status: "sent", sent_at: new Date().toISOString(), send_after: null })
      .eq("lead_id", v.lead.id).eq("company_id", v.profile.company_id).neq("status", "answered");
  }
  touch(v.lead.id);
  return { ok: "Sent on WhatsApp.", url };
}

// --------------------------------------------------------- appointments
export async function bookAppointment(_: FormState, form: FormData): Promise<FormState> {
  { const blocked = await pageBlocked("care", "edit"); if (blocked) return { error: blocked }; }
  const { profile } = await requireProfile();
  const p = z.object({
    lead_id: z.uuid("Invalid lead"),
    when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time"),
    minutes: z.coerce.number().int().min(5).max(600),
    note: z.string().trim().max(1000).default(""),
    assign: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
    send: on,
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const sb = await createClient();
  const { data: a, error } = await sb.rpc("lb_staff_book", { p_lead: p.data.lead_id, p_local: `${p.data.when}:00`, p_minutes: p.data.minutes, p_note: p.data.note, p_assign: p.data.assign });
  if (error) return fail(error);
  touch(p.data.lead_id);
  if (!p.data.send) return { ok: "Appointment booked." };
  if (!can(profile, "chats.send")) return { ok: "Appointment booked (you can't send WhatsApp messages, so the customer was not told)." };
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date((a as { starts_at: string }).starts_at));
  const { data: s } = await sb.from("lb_care_settings").select("booking_location").eq("company_id", profile.company_id).maybeSingle();
  const body = `✅ Your appointment is confirmed for ${when}.${s?.booking_location ? `\n📍 ${s.booking_location}` : ""}${p.data.note ? `\n${p.data.note}` : ""}`;
  const r = await sendText(p.data.lead_id, body);
  return r.error ? { ok: `Appointment booked. WhatsApp not sent: ${r.error}` } : { ok: "Appointment booked and sent on WhatsApp." };
}

export async function setAppointmentStatus(id: string, status: string): Promise<FormState> {
  { const blocked = await pageBlocked("care", "edit"); if (blocked) return { error: blocked }; }
  await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid appointment" };
  const { data, error } = await (await createClient()).rpc("lb_set_appointment", { p_id: id, p_status: status, p_note: null });
  if (error) return fail(error);
  touch((data as { lead_id?: string } | null)?.lead_id ?? undefined);
  return { ok: "Saved." };
}

// ------------------------------------------------------------ referrals
export async function addReferrer(_: FormState, form: FormData): Promise<FormState> {
  { const blocked = await pageBlocked("care", "edit"); if (blocked) return { error: blocked }; }
  const { profile } = await requireProfile();
  const leadId = String(form.get("lead_id") ?? "");
  if (!Uuid.safeParse(leadId).success) return { error: "Invalid lead" };
  const { data: co } = await (await createClient()).from("lb_companies").select("default_country").eq("id", profile.company_id).maybeSingle();
  const phone = normalizePhone(String(form.get("phone") ?? ""), co?.default_country ?? "IN");
  if (!phone) return { error: "Enter the referrer's mobile number." };
  const { error } = await (await createClient()).rpc("lb_add_referral", { p_lead: leadId, p_referrer_phone: phone });
  if (error) return fail(error);
  touch(leadId);
  return { ok: "Referrer saved." };
}

export async function setReferralStatus(id: string, status: string, note?: string): Promise<FormState> {
  { const blocked = await pageBlocked("care", "edit"); if (blocked) return { error: blocked }; }
  await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid referral" };
  const { error } = await (await createClient()).rpc("lb_set_referral", { p_id: id, p_status: status, p_note: note ?? null });
  if (error) return fail(error);
  touch();
  return { ok: "Saved." };
}
