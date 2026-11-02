"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone, errMsg } from "@/lib/util";
import { fromLocalInput } from "@/lib/dates";

type FormState = { error?: string; ok?: string; duplicate?: { lead_id: string; lead_no: number; visible: boolean } } | undefined;

const s = (v: FormDataEntryValue | null) => (v == null ? "" : String(v).trim());

function leadPayload(form: FormData) {
  return {
    name: s(form.get("name")), email: s(form.get("email")), location: s(form.get("location")),
    branch_id: s(form.get("branch_id")), department_id: s(form.get("department_id")), team_id: s(form.get("team_id")),
    product_id: s(form.get("product_id")), source_id: s(form.get("source_id")), priority: s(form.get("priority")) || "normal",
    expected_value: s(form.get("expected_value")), notes: s(form.get("notes")), owner_id: s(form.get("owner_id")),
    tag_ids: form.getAll("tag_ids").map(String).filter(Boolean),
    next_followup_at: fromLocalInput(s(form.get("next_followup_at"))) ?? "",
  };
}

export async function createLead(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const phone = normalizePhone(s(form.get("phone")));
  if (!phone) return { error: "Enter a valid mobile/WhatsApp number (with country code if not Indian)." };
  const email = s(form.get("email"));
  if (email && !z.email().safeParse(email).success) return { error: "Invalid email." };
  const ev = s(form.get("expected_value"));
  if (ev && !(Number(ev) >= 0)) return { error: "Expected value must be a positive number." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lb_create_lead", {
    p: { ...leadPayload(form), phone_e164: phone, force_repeat: form.get("force_repeat") === "1" },
  });
  if (error) return { error: errMsg(error) };
  if (data.status === "duplicate") {
    return { error: `This number already has lead LB-${data.lead_no}.`, duplicate: { lead_id: data.lead_id, lead_no: data.lead_no, visible: data.visible } };
  }
  revalidatePath("/leads");
  redirect(`/leads/${data.lead_id}?created=1`);
}

export async function updateLead(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const id = s(form.get("id"));
  const p = leadPayload(form);
  const email = p.email;
  if (email && !z.email().safeParse(email).success) return { error: "Invalid email." };
  const patch = {
    name: p.name, email: p.email, location: p.location, branch_id: p.branch_id, department_id: p.department_id,
    product_id: p.product_id, source_id: p.source_id, priority: p.priority, expected_value: p.expected_value, notes: p.notes,
    tag_ids: p.tag_ids, ...(form.has("won_value") ? { won_value: s(form.get("won_value")) } : {}),
  };
  const { error } = await (await createClient()).rpc("lb_update_lead", { p_lead: id, p: patch });
  if (error) return { error: errMsg(error) };
  revalidatePath(`/leads/${id}`);
  return { ok: "Lead saved." };
}

export async function changeStatus(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const id = s(form.get("id"));
  const won = s(form.get("won_value"));
  const { error } = await (await createClient()).rpc("lb_change_status", {
    p_lead: id, p_status: s(form.get("status_id")), p_reason: s(form.get("reason")) || null, p_won_value: won ? Number(won) : null,
  });
  if (error) return { error: errMsg(error) };
  revalidatePath(`/leads/${id}`);
  return { ok: "Status updated." };
}

export async function assignLeads(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const ids = form.getAll("lead_ids").map(String).filter(Boolean);
  if (!ids.length) return { error: "Select at least one lead." };
  const to = s(form.get("owner_id"));
  const supabase = await createClient();
  if (to === "__auto__") {
    const { data, error } = await supabase.rpc("lb_auto_allocate_leads", { p_leads: ids });
    if (error) return { error: errMsg(error) };
    revalidatePath("/leads");
    return { ok: `${data} lead(s) allocated by round-robin.${data < ids.length ? " Others had an owner, matched no rule, or every eligible user is at their limit." : ""}` };
  }
  const { data, error } = await supabase.rpc("lb_assign_leads", { p_leads: ids, p_to: to || null, p_reason: s(form.get("reason")) || null });
  if (error) return { error: errMsg(error) };
  revalidatePath("/leads");
  ids.forEach((i) => revalidatePath(`/leads/${i}`));
  return { ok: `${data} lead(s) ${to ? "assigned" : "unassigned"}.` };
}

export async function logActivity(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const id = s(form.get("id"));
  const { error } = await (await createClient()).rpc("lb_log_activity", { p_lead: id, p_type: s(form.get("type")), p_body: s(form.get("body")) });
  if (error) return { error: errMsg(error) };
  revalidatePath(`/leads/${id}`);
  return { ok: "Saved." };
}

export async function addFollowup(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const id = s(form.get("id"));
  const due = fromLocalInput(s(form.get("due_at")));
  if (!due) return { error: "Pick a date and time." };
  const { error } = await (await createClient()).rpc("lb_add_followup", { p_lead: id, p_due: due, p_note: s(form.get("note")) });
  if (error) return { error: errMsg(error) };
  revalidatePath(`/leads/${id}`);
  revalidatePath("/followups");
  return { ok: "Follow-up scheduled." };
}

export async function completeFollowup(id: string, cancel = false): Promise<FormState> {
  await requireProfile();
  const { error } = await (await createClient()).rpc("lb_complete_followup", { p_followup: id, p_note: null, p_cancel: cancel });
  if (error) return { error: errMsg(error) };
  revalidatePath("/followups");
  return { ok: cancel ? "Cancelled." : "Marked done." };
}

export async function startConversation(leadId: string, numberId: string): Promise<{ error?: string; id?: string }> {
  await requireProfile();
  const { data, error } = await (await createClient()).rpc("lb_start_conversation", { p_lead: leadId, p_number: numberId });
  if (error) return { error: errMsg(error) };
  return { id: data };
}

// Inline edits from the leads list. One field per call; the list refreshes after.
export type QuickEdit =
  | { kind: "status"; status_id: string; reason?: string; won_value?: string; due?: string }
  | { kind: "sub_status"; sub_status_id: string | null }
  | { kind: "product"; product_id: string | null }
  | { kind: "followup"; due: string }
  | { kind: "remark"; text: string };

export async function quickEditLead(id: string, e: QuickEdit): Promise<{ error?: string }> {
  await requireProfile();
  const sb = await createClient();
  let error: { message: string } | null = null;
  if (e.kind === "status") {
    const due = e.due ? fromLocalInput(e.due) : null;
    ({ error } = await sb.rpc("lb_change_status_with_action", {
      p_lead: id, p_status: e.status_id, p_reason: e.reason?.trim() || null, p_won_value: e.won_value ? Number(e.won_value) : null,
      p_action_type: "call", p_action_note: null, p_due: due,
    }));
  } else if (e.kind === "sub_status") {
    ({ error } = await sb.rpc("lb_set_sub_status", { p_lead: id, p_sub_status: e.sub_status_id || null }));
  } else if (e.kind === "product") {
    ({ error } = await sb.rpc("lb_update_lead", { p_lead: id, p: { product_id: e.product_id ?? "" } }));
  } else if (e.kind === "followup") {
    const due = fromLocalInput(e.due);
    if (!due) return { error: "Pick a date and time." };
    ({ error } = await sb.rpc("lb_set_next_followup", { p_lead: id, p_due: due }));
  } else if (e.kind === "remark") {
    if (!e.text.trim()) return { error: "Write a remark." };
    ({ error } = await sb.rpc("lb_log_activity", { p_lead: id, p_type: "note", p_body: e.text.trim().slice(0, 2000) }));
  }
  if (error) return { error: errMsg(error) };
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  return {};
}

// "Chat" from the leads list: open the customer's latest inbox chat, or start
// one on the lead's own WhatsApp number (else the company's first active number).
export async function openLeadChat(leadId: string): Promise<{ error?: string; id?: string }> {
  await requireProfile();
  const sb = await createClient();
  const { data: lead } = await sb.from("lb_leads").select("id,company_id,customer_id,number_id").eq("id", leadId).maybeSingle();
  if (!lead) return { error: "Lead not found." };
  const { data: conv } = await sb.from("lb_conversations").select("id").eq("customer_id", lead.customer_id)
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (conv) return { id: conv.id };
  let numberId: string | null = lead.number_id;
  if (!numberId) {
    const { data: n } = await sb.from("lb_wa_numbers").select("id").eq("company_id", lead.company_id).eq("is_active", true).order("label").limit(1).maybeSingle();
    numberId = n?.id ?? null;
  }
  if (!numberId) return { error: "No WhatsApp number is connected yet." };
  const { data, error } = await sb.rpc("lb_start_conversation", { p_lead: leadId, p_number: numberId });
  if (error) return { error: errMsg(error) };
  return { id: data };
}

// Soft delete / restore (company admins only; enforced in lb_delete_leads / lb_restore_leads).
const Ids = z.array(z.string().uuid()).min(1).max(500);
export async function deleteLeads(ids: string[]): Promise<{ error?: string; n?: number }> {
  await requireProfile();
  const parsed = Ids.safeParse(ids);
  if (!parsed.success) return { error: "Select at least one lead." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("lb_delete_leads", { p_leads: parsed.data });
  if (error) return { error: errMsg(error) };
  revalidatePath("/leads");
  return { n: data as number };
}

export async function restoreLeads(ids: string[]): Promise<{ error?: string; n?: number }> {
  await requireProfile();
  const parsed = Ids.safeParse(ids);
  if (!parsed.success) return { error: "Select at least one lead." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("lb_restore_leads", { p_leads: parsed.data });
  if (error) return { error: errMsg(error) };
  revalidatePath("/leads");
  return { n: data as number };
}
