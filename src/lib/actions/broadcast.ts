"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { fromLocalInput } from "@/lib/dates";
import { SMART_KEYS, type SmartKey } from "@/lib/segments";

// ---------------------------------------------------------------- broadcast
export type BroadcastRules = {
  status_ids?: string[]; sub_status_ids?: string[]; tag_ids?: string[]; source_ids?: string[]; product_ids?: string[]; owner_ids?: string[];
  include_closed?: boolean; created_within_days?: string; inactive_days?: string; smart?: SmartKey[];
};
export type Audience = { lead_ids: string[] } | { rules: BroadcastRules };
export type Preview = { total: number; eligible: number; opted_out: number; no_consent: number; suppressed: number; sample: { name: string | null; phone_e164: string }[] };
export type BroadcastTemplate = { name: string; language: string; category: string | null; waba_id: string; body: string };
export type BroadcastRefs = { numbers: { id: string; label: string; waba_id: string }[]; templates: BroadcastTemplate[]; canConsent: boolean; canApprove: boolean };

const Uuids = z.array(z.string().uuid()).max(5000);
const RulesSchema = z.object({
  status_ids: Uuids.optional(), sub_status_ids: Uuids.optional(), tag_ids: Uuids.optional(), source_ids: Uuids.optional(),
  product_ids: Uuids.optional(), owner_ids: Uuids.optional(), include_closed: z.boolean().optional(),
  created_within_days: z.string().regex(/^\d{0,4}$/).optional(), inactive_days: z.string().regex(/^\d{0,4}$/).optional(),
  smart: z.array(z.enum(SMART_KEYS as [SmartKey, ...SmartKey[]])).max(SMART_KEYS.length).optional(),
});
const AudienceSchema = z.union([z.object({ lead_ids: Uuids.min(1) }), z.object({ rules: RulesSchema })]);

/** Numbers + approved templates for the broadcast form (loaded when the form opens). */
export async function getBroadcastRefs(): Promise<BroadcastRefs & { error?: string }> {
  const { profile } = await requireProfile();
  const empty = { numbers: [], templates: [], canConsent: false, canApprove: false };
  if (!can(profile, "campaigns.manage")) return { ...empty, error: "You need the “Create campaigns & segments” permission to send a broadcast." };
  const sb = await createClient();
  const [{ data: numbers }, { data: templates }] = await Promise.all([
    sb.from("lb_wa_numbers").select("id,label,waba_id").eq("company_id", profile.company_id).eq("is_active", true).order("label"),
    sb.from("lb_wa_templates").select("name,language,category,waba_id,components").eq("company_id", profile.company_id).eq("status", "APPROVED").order("name"),
  ]);
  return {
    numbers: numbers ?? [],
    templates: (templates ?? []).map((t) => ({ name: t.name, language: t.language, category: t.category, waba_id: t.waba_id,
      body: ((t.components as { type: string; text?: string }[] | null)?.find((x) => x.type === "BODY")?.text) ?? "" })),
    canConsent: can(profile, "consent.manage"), canApprove: can(profile, "campaigns.approve"),
  };
}

export async function previewBroadcast(audience: Audience, attestOptIn = false): Promise<{ error?: string; preview?: Preview }> {
  await requireProfile();
  const a = AudienceSchema.safeParse(audience);
  if (!a.success) return { error: "Invalid audience" };
  const { data, error } = await (await createClient()).rpc("lb_broadcast", { p: { ...a.data, dry_run: true, opt_in_note: attestOptIn ? "preview" : null } });
  if (error) return { error: errMsg(error) };
  return { preview: (data as { preview: Preview }).preview };
}

export type SendInput = {
  audience: Audience; name: string; number_id: string; template: string; params: string[]; scheduled_at?: string; opt_in_note?: string;
};
export async function sendBroadcast(input: SendInput): Promise<{ error?: string; id?: string; status?: string; name?: string; opted_in?: number }> {
  await requireProfile();
  const a = AudienceSchema.safeParse(input.audience);
  if (!a.success) return { error: "Invalid audience" };
  const [template_name, template_language] = (input.template ?? "").split("|");
  if (!template_name || !template_language) return { error: "Choose an approved template." };
  const { data, error } = await (await createClient()).rpc("lb_broadcast", { p: {
    ...a.data, name: input.name?.trim(), number_id: input.number_id, template_name, template_language,
    template_params: (input.params ?? []).map((x) => String(x).slice(0, 500)),
    scheduled_at: input.scheduled_at ? fromLocalInput(input.scheduled_at) : null,
    opt_in_note: input.opt_in_note?.trim() || null,
  } });
  if (error) return { error: errMsg(error) };
  const r = data as { campaign_id: string; status: string; name: string; opted_in: number };
  revalidatePath("/whatsapp/campaigns");
  revalidatePath("/nurture/campaigns");
  return { id: r.campaign_id, status: r.status, name: r.name, opted_in: r.opted_in };
}

// ---------------------------------------------------------------- bulk lead actions
export type BulkAction =
  | { action: "status"; status_id: string; reason?: string; due?: string }
  | { action: "sub_status"; sub_status_id: string | null }
  | { action: "tags_add" | "tags_remove"; tag_ids: string[] }
  | { action: "priority"; priority: "low" | "normal" | "high" | "urgent" };

export async function bulkUpdateLeads(ids: string[], a: BulkAction): Promise<{ error?: string; ok?: number; failed?: number; errors?: Record<string, number> }> {
  await requireProfile();
  const parsed = z.array(z.string().uuid()).min(1).max(500).safeParse(ids);
  if (!parsed.success) return { error: "Select between 1 and 500 leads." };
  const p: Record<string, unknown> = { ...a };
  if (a.action === "status") p.due = a.due ? fromLocalInput(a.due) : null;
  const { data, error } = await (await createClient()).rpc("lb_bulk_update_leads", { p_leads: parsed.data, p });
  if (error) return { error: errMsg(error) };
  revalidatePath("/leads");
  return data as { ok: number; failed: number; errors: Record<string, number> };
}
