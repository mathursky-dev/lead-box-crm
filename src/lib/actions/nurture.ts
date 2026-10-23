"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile, requireAdmin } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import { fromLocalInput } from "@/lib/dates";
import Papa from "papaparse";

type FormState = { error?: string; ok?: string } | undefined;
const s = (v: FormDataEntryValue | null) => (v == null ? "" : String(v).trim());

async function rpc(name: string, args: Record<string, unknown>) {
  await requireProfile();
  const { data, error } = await (await createClient()).rpc(name, args);
  if (error) throw new Error(errMsg(error));
  return data;
}
const wrap = async (fn: () => Promise<unknown>, ok: string, paths: string[] = []): Promise<FormState> => {
  try { await fn(); paths.forEach((p) => revalidatePath(p)); return { ok }; } catch (e) { return { error: (e as Error).message }; }
};

// ---------------------------------------------------------- lead next action / payment
export async function changeStatusWithAction(_: FormState, form: FormData): Promise<FormState> {
  const id = s(form.get("id"));
  const won = s(form.get("won_value"));
  return wrap(() => rpc("lb_change_status_with_action", {
    p_lead: id, p_status: s(form.get("status_id")), p_reason: s(form.get("reason")) || null, p_won_value: won ? Number(won) : null,
    p_action_type: s(form.get("action_type")) || "call", p_action_note: s(form.get("action_note")) || null, p_due: fromLocalInput(s(form.get("action_due"))),
  }), "Status and next action saved.", [`/leads/${id}`]);
}

export async function setPayment(_: FormState, form: FormData): Promise<FormState> {
  const id = s(form.get("id"));
  const amt = s(form.get("amount"));
  return wrap(() => rpc("lb_set_payment", { p_lead: id, p_status: s(form.get("payment_status")), p_amount: amt ? Number(amt) : null, p_due: fromLocalInput(s(form.get("due"))) }),
    "Payment updated.", [`/leads/${id}`, "/nurture"]);
}

// ---------------------------------------------------------- enrollments
export async function enrollLead(_: FormState, form: FormData): Promise<FormState> {
  const lead = s(form.get("lead_id"));
  return wrap(() => rpc("lb_enroll_lead", { p_journey: s(form.get("journey_id")), p_lead: lead, p_force: form.get("force") === "on" }), "Lead enrolled.", [`/leads/${lead}`]);
}
export async function enrollmentAction(id: string, action: "pause" | "resume" | "stop"): Promise<FormState> {
  return wrap(() => rpc("lb_enrollment_action", { p_enrollment: id, p_action: action }), "Done.", ["/nurture"]);
}

// ---------------------------------------------------------- journeys
export async function saveJourney(payload: Record<string, unknown>): Promise<{ error?: string; id?: string }> {
  try { const id = await rpc("lb_save_journey", { p: payload }); revalidatePath("/nurture/journeys"); return { id }; }
  catch (e) { return { error: (e as Error).message }; }
}
export async function journeyAction(id: string, action: "activate" | "pause" | "archive"): Promise<FormState> {
  return wrap(() => rpc("lb_journey_action", { p_journey: id, p_action: action }), `Journey ${action === "activate" ? "activated" : action === "pause" ? "paused" : "archived"}.`, ["/nurture/journeys", `/nurture/journeys/${id}`]);
}

// ---------------------------------------------------------- segments
export async function saveSegment(_: FormState, form: FormData): Promise<FormState> {
  const list = (k: string) => form.getAll(k).map(String).filter(Boolean);
  const rules = {
    categories: list("categories"), product_ids: list("product_ids"), source_ids: list("source_ids"), tag_ids: list("tag_ids"),
    number_id: s(form.get("number_id")), priority: list("priority").join(","), inactive_days: s(form.get("inactive_days")),
    created_within_days: s(form.get("created_within_days")), purchased: s(form.get("purchased")) || "any", replied_days: s(form.get("replied_days")),
    include_closed: form.get("include_closed") === "on",
  };
  return wrap(() => rpc("lb_save_segment", { p: { id: s(form.get("id")), name: s(form.get("name")), rules } }), "Segment saved.", ["/nurture/segments"]);
}

/** CSV audience (ported from wacrm): creates a list segment from a phone/name CSV. */
export async function importSegmentCsv(_: FormState, form: FormData): Promise<FormState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file" };
  if (file.size > 2 * 1024 * 1024) return { error: "CSV must be 2 MB or smaller" };
  const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const cols = parsed.meta.fields ?? [];
  const phoneCol = cols.find((c) => /phone|mobile|whatsapp|number|contact/.test(c));
  const nameCol = cols.find((c) => /name/.test(c));
  if (!phoneCol) return { error: "No phone column found — add a header such as “phone” or “mobile”." };
  const seen = new Set<string>();
  let invalid = 0;
  const rows: { phone: string; name: string }[] = [];
  for (const r of parsed.data) {
    const phone = normalizePhone(r[phoneCol] ?? "");
    if (!phone) { invalid++; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone); rows.push({ phone, name: nameCol ? (r[nameCol] ?? "").trim() : "" });
  }
  if (!rows.length) return { error: `No valid phone numbers found (${invalid} invalid).` };
  try {
    const r = await rpc("lb_import_segment_list", { p_name: s(form.get("name")), p_rows: rows, p_opt_in: form.get("opt_in") === "on", p_note: s(form.get("note")) || null });
    revalidatePath("/nurture/segments");
    return { ok: `List created: ${rows.length} contacts (${r.new} new, ${r.existing} existing${r.opted_in ? `, ${r.opted_in} opt-ins recorded` : ""}). Skipped ${invalid} invalid and ${parsed.data.length - rows.length - invalid} duplicate rows.` };
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------------------------------------------------------- offers
export async function saveOffer(_: FormState, form: FormData): Promise<FormState> {
  return wrap(() => rpc("lb_save_offer", { p: {
    id: s(form.get("id")), name: s(form.get("name")), description: s(form.get("description")), code: s(form.get("code")),
    valid_from: fromLocalInput(s(form.get("valid_from"))), valid_to: fromLocalInput(s(form.get("valid_to"))),
  } }), "Offer saved as draft. Submit it for approval before use.", ["/nurture/offers"]);
}
export async function offerAction(id: string, action: "submit" | "approve" | "reject", reason?: string): Promise<FormState> {
  return wrap(() => rpc("lb_offer_action", { p_offer: id, p_action: action, p_reason: reason ?? null }), "Done.", ["/nurture/offers"]);
}

// ---------------------------------------------------------- campaigns
export async function saveCampaign(_: FormState, form: FormData): Promise<FormState> {
  const [template_name, template_language] = s(form.get("template")).split("|");
  let id: string | undefined;
  const r = await wrap(async () => {
    id = await rpc("lb_save_campaign", { p: {
      id: s(form.get("id")), name: s(form.get("name")), segment_id: s(form.get("segment_id")), number_id: s(form.get("number_id")),
      template_name, template_language, template_params: form.getAll("params").map(String), offer_id: s(form.get("offer_id")),
      scheduled_at: fromLocalInput(s(form.get("scheduled_at"))),
    } });
  }, "Campaign saved.", ["/nurture/campaigns"]);
  if (r?.error || !id) return r;
  redirect(`/nurture/campaigns/${id}`);
}
export async function campaignAction(id: string, action: "submit" | "approve" | "reject" | "cancel"): Promise<FormState> {
  return wrap(() => rpc("lb_campaign_action", { p_campaign: id, p_action: action }), "Done.", ["/nurture/campaigns", `/nurture/campaigns/${id}`]);
}

// ---------------------------------------------------------- consent & suppression
export async function setConsent(_: FormState, form: FormData): Promise<FormState> {
  const c = s(form.get("customer_id"));
  return wrap(() => rpc("lb_set_consent", { p_customer: c, p_status: s(form.get("status")), p_note: s(form.get("note")) }), "Consent recorded.", [`/customers/${c}`]);
}
export async function suppression(_: FormState, form: FormData): Promise<FormState> {
  const phone = normalizePhone(s(form.get("phone")));
  if (!phone) return { error: "Enter a valid phone number." };
  return wrap(() => rpc("lb_suppression_action", { p_phone: phone, p_action: s(form.get("action")) || "add", p_reason: s(form.get("reason")) }),
    "Suppression list updated.", ["/nurture/consent"]);
}
export async function removeSuppression(phone: string): Promise<FormState> {
  return wrap(() => rpc("lb_suppression_action", { p_phone: phone, p_action: "remove", p_reason: null }), "Removed.", ["/nurture/consent"]);
}

// ---------------------------------------------------------- company nurture policy
export async function saveNurtureSettings(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const n = (k: string) => Number(s(form.get(k)));
  const v = {
    sla_first_response_minutes: n("sla_first_response_minutes"), sla_escalation_minutes: n("sla_escalation_minutes"),
    quiet_hours_start: s(form.get("quiet_hours_start")) || "21:00", quiet_hours_end: s(form.get("quiet_hours_end")) || "09:00",
    marketing_cap_per_week: n("marketing_cap_per_week"), require_next_action: form.get("require_next_action") === "on",
  };
  if (!(v.sla_first_response_minutes >= 1) || !(v.sla_escalation_minutes > v.sla_first_response_minutes)) return { error: "Escalation must be later than the first-response SLA." };
  const { error } = await (await createClient()).from("lb_companies").update(v).eq("id", me.company_id);
  if (error) return { error: error.message };
  await createAdminClient().from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action: "company.nurture_settings", entity: "company", entity_id: me.company_id, data: v });
  revalidatePath("/admin/settings");
  return { ok: "Nurturing policy saved." };
}
