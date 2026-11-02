"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile, can, type Profile } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import { enqueue } from "@/lib/inbox-send";
import { openLeadChat } from "@/lib/actions/leads";
import { RET_NOT_READY, retNotReady } from "@/lib/retention-server";

// Loyalty points, service tickets, renewals and wishes. Settings use the service role pinned to the admin's active
// company; everything else goes through RPCs that check visibility and permissions themselves.

type FormState = { error?: string; ok?: string } | undefined;
const Uuid = z.uuid();
const on = z.string().optional().transform((v) => v === "on");
const optUuid = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);
const fail = (e: unknown): FormState => { const m = errMsg(e); return { error: retNotReady(m) ? RET_NOT_READY : m }; };
const first = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input";

const touch = (leadId?: string | null) => {
  revalidatePath("/care", "layout");
  if (leadId) revalidatePath(`/leads/${leadId}`);
};

async function audit(me: Profile, action: string, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action, entity: "care", entity_id: null, data });
}

/** Customer of the active company by mobile number (visible to the user). */
async function customerByPhone(me: Profile, raw: string) {
  const sb = await createClient();
  const { data: co } = await sb.from("lb_companies").select("default_country").eq("id", me.company_id).maybeSingle();
  const phone = normalizePhone(String(raw ?? ""), co?.default_country ?? "IN");
  if (!phone) return { error: "Enter a valid mobile number." } as const;
  const { data: c } = await sb.from("lb_customers").select("id,name").eq("company_id", me.company_id).eq("phone_e164", phone).maybeSingle();
  if (!c) return { error: `No customer with ${phone} in your CRM. Add the lead first.` } as const;
  return { id: c.id as string };
}

async function sendText(leadId: string, body: string): Promise<{ error?: string }> {
  const chat = await openLeadChat(leadId);
  if (chat.error || !chat.id) return { error: chat.error ?? "No WhatsApp chat for this lead." };
  const r = await enqueue(chat.id, randomUUID(), { type: "text", body: body.slice(0, 4096) });
  if (r.error && !r.ok) return { error: /24-hour/.test(r.error) ? "WhatsApp 24-hour window is closed. Send a template from the chat." : r.error };
  return {};
}

// ------------------------------------------------------------- settings
const hoursMap = (form: FormData, prefix: string) => {
  const out: Record<string, number> = {};
  for (const p of ["urgent", "high", "normal", "low"]) {
    const v = Number(form.get(`${prefix}_${p}`));
    if (!Number.isFinite(v) || v < 0 || v > 2000) return null;
    out[p] = Math.round(v * 100) / 100;
  }
  return out;
};

export async function saveRetentionSettings(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!hasServiceRole()) return { error: "The server is not configured (service role key)." };
  const section = String(form.get("section") ?? "");
  const f = Object.fromEntries(form);
  const db = createAdminClient();
  let row: Record<string, unknown>;
  const tpl = z.string().trim().max(512).optional().transform((v) => v || null);
  const lang = z.string().trim().max(15).optional().transform((v) => v || null);

  async function numberOk(id: string | null) {
    return !id || Boolean((await db.from("lb_wa_numbers").select("id").eq("id", id).eq("company_id", me.company_id).maybeSingle()).data);
  }

  if (section === "loyalty") {
    const p = z.object({
      loyalty_enabled: on, earn_on_won: on, earn_on_orders: on,
      points_per_100: z.coerce.number().min(0, "Points per ₹100: 0–1000").max(1000, "Points per ₹100: 0–1000"),
      point_value: z.coerce.number().gt(0, "Value of 1 point must be more than ₹0").max(1000),
      min_redeem: z.coerce.number().int().min(0).max(1000000),
      max_redeem_pct: z.coerce.number().int().min(1, "Max % of bill: 1–100").max(100, "Max % of bill: 1–100"),
      expiry_months: z.union([z.literal(""), z.coerce.number().int().min(1, "Expiry: 1–120 months").max(120, "Expiry: 1–120 months")]).transform((v) => (v === "" ? null : v)),
      birthday_points: z.coerce.number().int().min(0).max(100000),
    }).safeParse(f);
    if (!p.success) return { error: first(p.error) };
    row = p.data;
  } else if (section === "tickets") {
    const p = z.object({
      tickets_from_complaints: on, portal_tickets: on, ticket_wa_updates: on,
      auto_close_days: z.coerce.number().int().min(0).max(90, "Auto close: 0–90 days"),
      ticket_categories: z.string().max(2000).default(""),
    }).safeParse(f);
    if (!p.success) return { error: first(p.error) };
    const resp = hoursMap(form, "resp"), res = hoursMap(form, "res");
    if (!resp || !res) return { error: "SLA hours must be numbers from 0 to 2000 (0 = no limit)." };
    const cats = [...new Set(p.data.ticket_categories.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 30).map((x) => x.slice(0, 60));
    row = { ...p.data, ticket_categories: cats.length ? cats : ["Other"], sla_response_hours: resp, sla_resolve_hours: res };
  } else if (section === "renewals") {
    const p = z.object({
      renewal_auto_wa: on,
      renewal_remind_days: z.string().max(200).default(""),
      renewal_lapse_days: z.coerce.number().int().min(0).max(365, "Lapse after: 0–365 days"),
      renewal_number_id: optUuid, renewal_template: tpl, renewal_template_lang: lang,
    }).safeParse(f);
    if (!p.success) return { error: first(p.error) };
    const days = [...new Set(p.data.renewal_remind_days.split(/[\s,]+/).filter(Boolean).map(Number))];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 365)) return { error: "Reminder days: whole numbers 0–365, separated by commas (0 = on the due date)." };
    if (p.data.renewal_auto_wa && (!p.data.renewal_number_id || !p.data.renewal_template || !p.data.renewal_template_lang))
      return { error: "For automatic WhatsApp pick the number and the approved template (name + language)." };
    if (!(await numberOk(p.data.renewal_number_id))) return { error: "Invalid WhatsApp number" };
    row = { ...p.data, renewal_remind_days: days.sort((a, b) => b - a).slice(0, 10) };
  } else if (section === "wishes") {
    const p = z.object({
      wishes_enabled: on, wish_notify_owner: on,
      wish_hour: z.coerce.number().int().min(0).max(23),
      wish_number_id: optUuid, birthday_template: tpl, birthday_template_lang: lang, anniversary_template: tpl, anniversary_template_lang: lang,
    }).safeParse(f);
    if (!p.success) return { error: first(p.error) };
    if (p.data.wishes_enabled && (!p.data.wish_number_id || (!p.data.birthday_template && !p.data.anniversary_template)))
      return { error: "For automatic wishes pick the WhatsApp number and at least one approved template." };
    if ((p.data.birthday_template && !p.data.birthday_template_lang) || (p.data.anniversary_template && !p.data.anniversary_template_lang))
      return { error: "Pick the template language too." };
    if (!(await numberOk(p.data.wish_number_id))) return { error: "Invalid WhatsApp number" };
    row = p.data;
  } else return { error: "Unknown section" };

  const { error } = await db.from("lb_retention_settings").upsert({ ...row, company_id: me.company_id, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return fail(error);
  await audit(me, `care.settings.${section}`, { enabled: row.loyalty_enabled ?? row.renewal_auto_wa ?? row.wishes_enabled ?? row.portal_tickets });
  touch();
  return { ok: "Saved." };
}

// -------------------------------------------------------------- tickets
export async function saveTicket(_: FormState, form: FormData): Promise<FormState> {
  const { profile } = await requireProfile();
  const p = z.object({
    id: optUuid, lead_id: optUuid, customer_id: optUuid, phone: z.string().max(40).optional(),
    subject: z.string().trim().min(1, "Subject is required").max(200),
    description: z.string().trim().max(4000).default(""),
    category: z.string().trim().max(60).default(""),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    assigned_to: optUuid,
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  let customer = p.data.customer_id;
  if (!p.data.id && !p.data.lead_id && !customer) {
    const c = await customerByPhone(profile, p.data.phone ?? "");
    if ("error" in c) return { error: c.error };
    customer = c.id;
  }
  const { data, error } = await (await createClient()).rpc("lb_ticket_save", { p: { ...p.data, customer_id: customer, phone: undefined } });
  if (error) return fail(error);
  const t = data as { id: string; lead_id: string | null; ticket_no: number };
  touch(t.lead_id);
  revalidatePath(`/care/tickets/${t.id}`);
  return { ok: p.data.id ? "Saved." : `Ticket TK-${t.ticket_no} created.` };
}

export async function setTicketStatus(id: string, status: string, note?: string): Promise<FormState> {
  await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid ticket" };
  const { data, error } = await (await createClient()).rpc("lb_ticket_set_status", { p_id: id, p_status: status, p_note: note ?? null });
  if (error) return fail(error);
  touch((data as { lead_id?: string } | null)?.lead_id);
  revalidatePath(`/care/tickets/${id}`);
  return { ok: "Saved." };
}

export async function addTicketComment(_: FormState, form: FormData): Promise<FormState> {
  const { profile } = await requireProfile();
  const p = z.object({ id: z.uuid(), body: z.string().trim().min(1, "Write something").max(4000), internal: on, send: on }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  const sb = await createClient();
  const { error } = await sb.rpc("lb_ticket_comment", { p_id: p.data.id, p_body: p.data.body, p_internal: p.data.internal });
  if (error) return fail(error);
  revalidatePath(`/care/tickets/${p.data.id}`);
  if (p.data.send && !p.data.internal && can(profile, "chats.send")) {
    const { data: t } = await sb.from("lb_tickets").select("lead_id,ticket_no").eq("id", p.data.id).maybeSingle();
    if (t?.lead_id) {
      const r = await sendText(t.lead_id as string, `🛠️ Ticket TK-${t.ticket_no}: ${p.data.body}`);
      if (r.error) return { ok: `Reply saved. WhatsApp not sent: ${r.error}` };
      return { ok: "Reply saved and sent on WhatsApp." };
    }
    return { ok: "Reply saved (no lead, so nothing was sent on WhatsApp)." };
  }
  return { ok: "Saved." };
}

// ------------------------------------------------------------- renewals
export async function saveRenewal(_: FormState, form: FormData): Promise<FormState> {
  const { profile } = await requireProfile();
  const p = z.object({
    id: optUuid, lead_id: optUuid, customer_id: optUuid, phone: z.string().max(40).optional(),
    title: z.string().trim().min(1, "Title is required").max(160),
    kind: z.enum(["amc", "subscription", "warranty", "service", "insurance", "other"]).default("amc"),
    start_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Invalid start date").default(""),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date is required"),
    repeat_months: z.string().regex(/^\d{0,3}$/, "Repeat: months as a number").default(""),
    amount: z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "Amount: a number like 2500").default(""),
    assigned_to: optUuid, product_id: optUuid,
    notes: z.string().trim().max(2000).default(""),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  let customer = p.data.customer_id;
  if (!p.data.id && !p.data.lead_id && !customer) {
    const c = await customerByPhone(profile, p.data.phone ?? "");
    if ("error" in c) return { error: c.error };
    customer = c.id;
  }
  const { data, error } = await (await createClient()).rpc("lb_renewal_save", { p: { ...p.data, customer_id: customer, phone: undefined } });
  if (error) return fail(error);
  touch((data as { lead_id?: string } | null)?.lead_id);
  return { ok: p.data.id ? "Saved." : "Renewal added. Reminders will go out before the due date." };
}

export async function renewalAction(id: string, action: "renewed" | "cancel" | "reactivate", note?: string, amount?: number | null): Promise<FormState> {
  await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid renewal" };
  const { data, error } = await (await createClient()).rpc("lb_renewal_action", { p_id: id, p_action: action, p_note: note ?? null, p_amount: amount ?? null });
  if (error) return fail(error);
  touch((data as { lead_id?: string } | null)?.lead_id);
  return { ok: "Saved." };
}

// -------------------------------------------------------------- loyalty
export async function redeemPoints(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const p = z.object({
    customer_id: z.uuid(), lead_id: optUuid,
    points: z.coerce.number().int().min(1, "Enter the points to redeem"),
    bill: z.coerce.number().gt(0, "Enter the bill amount"),
    note: z.string().trim().max(300).default(""),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  const { data, error } = await (await createClient()).rpc("lb_loyalty_redeem", { p_customer: p.data.customer_id, p_points: p.data.points, p_bill: p.data.bill, p_note: p.data.note, p_lead: p.data.lead_id });
  if (error) return fail(error);
  const r = data as { discount: number; balance: number };
  touch(p.data.lead_id);
  return { ok: `Redeemed. Give ₹${Number(r.discount).toLocaleString("en-IN")} discount. Balance now ${r.balance} points.` };
}

export async function adjustPoints(_: FormState, form: FormData): Promise<FormState> {
  const { profile } = await requireAdmin();
  const p = z.object({
    customer_id: optUuid, phone: z.string().max(40).optional(), lead_id: optUuid,
    points: z.coerce.number().int().refine((v) => v !== 0, "Enter the points (+ to add, − to remove)"),
    note: z.string().trim().min(1, "Write a reason").max(300),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  let customer = p.data.customer_id;
  if (!customer) {
    const c = await customerByPhone(profile, p.data.phone ?? "");
    if ("error" in c) return { error: c.error };
    customer = c.id;
  }
  const { data, error } = await (await createClient()).rpc("lb_loyalty_adjust", { p_customer: customer, p_points: p.data.points, p_note: p.data.note });
  if (error) return fail(error);
  touch(p.data.lead_id);
  return { ok: `Saved. Balance now ${data} points.` };
}

// ------------------------------------------------------- customer dates
export async function saveCustomerDates(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const d = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Invalid date").transform((v) => v || null);
  const p = z.object({ customer_id: z.uuid(), lead_id: optUuid, birthday: d, anniversary: d }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  const { error } = await (await createClient()).rpc("lb_set_customer_dates", { p_customer: p.data.customer_id, p_birthday: p.data.birthday, p_anniversary: p.data.anniversary });
  if (error) return fail(error);
  touch(p.data.lead_id);
  return { ok: "Saved." };
}
