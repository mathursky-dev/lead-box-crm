"use server";
import { revalidatePath } from "next/cache";
import { requireProfile, requireAdmin } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";

type R = { error?: string; ok?: string };
const s = (v: FormDataEntryValue | null) => (v == null ? "" : String(v).trim());

async function call(name: string, args: Record<string, unknown>, ok: string, paths: string[] = []): Promise<R> {
  await requireProfile();
  const { error } = await (await createClient()).rpc(name, args);
  if (error) return { error: errMsg(error) };
  paths.forEach((p) => revalidatePath(p));
  return { ok };
}

export const complaintAction = async (convId: string, action: "raise" | "resolve", note: string, complaintId?: string) =>
  call("lb_complaint_action", { p_conv: convId || null, p_action: action, p_note: note || null, p_complaint: complaintId ?? null }, action === "raise" ? "Complaint raised." : "Resolved.", ["/nurture"]);

export const customerPause = async (customerId: string, until: string | null) =>
  call("lb_set_customer_pause", { p_customer: customerId, p_until: until }, until ? "Paused." : "Resumed.", [`/customers/${customerId}`]);

export const setAvailability = async (status: "available" | "away" | "offline") =>
  call("lb_set_my_availability", { p_status: status }, "Availability updated.", ["/", "/admin/users"]);

export const automationPause = async (paused: boolean, reason: string) =>
  call("lb_set_automation_pause", { p_paused: paused, p_reason: reason || null }, paused ? "All automation paused." : "Automation resumed.", ["/nurture", "/nurture/journeys"]);

export const publishJourney = async (id: string) =>
  call("lb_publish_journey", { p_journey: id }, "Published. New enrolments use this version; running ones finish on theirs.", ["/nurture/journeys", `/nurture/journeys/${id}`]);

export const failedJobAction = async (kind: "enrollment" | "job", id: string, action: "retry" | "dismiss") =>
  call("lb_failed_job_action", { p_kind: kind, p_id: id, p_action: action }, action === "retry" ? "Retry scheduled." : "Dismissed.", ["/nurture"]);

export const knowledgeAction = async (id: string, action: "approve" | "archive" | "draft") =>
  call("lb_knowledge_action", { p_id: id, p_action: action }, "Saved.", ["/nurture/knowledge"]);

export async function saveKnowledge(_: R | undefined, form: FormData): Promise<R> {
  return call("lb_save_knowledge", { p: { id: s(form.get("id")), title: s(form.get("title")), content: s(form.get("content")) } },
    "Saved as draft — approve it before AI can use it.", ["/nurture/knowledge"]);
}

/** Company-level automation settings: AI on/off, detection keywords, digest hour. */
export async function saveAutomationSettings(_: R | undefined, form: FormData): Promise<R> {
  const { profile: me } = await requireAdmin();
  const words = (k: string) => s(form.get(k)).split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const complaint = words("complaint_keywords"), buying = words("buying_keywords");
  if ([...complaint, ...buying].some((w) => !/^[\p{L}\p{N} ]{2,40}$/u.test(w))) return { error: "Keywords may only contain letters, numbers and spaces." };
  const v = { ai_enabled: form.get("ai_enabled") === "on", complaint_keywords: complaint, buying_keywords: buying, digest_hour: Number(s(form.get("digest_hour")) || 9) };
  const { error } = await (await createClient()).from("lb_companies").update(v).eq("id", me.company_id);
  if (error) return { error: error.message };
  await createAdminClient().from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action: "company.automation_settings", entity: "company", entity_id: me.company_id, data: v });
  revalidatePath("/admin/settings");
  return { ok: "Automation settings saved." };
}
