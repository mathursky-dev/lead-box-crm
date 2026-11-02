"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { DEFAULT_SEGMENT_SETTINGS, isSmartKey, type SegmentSettings, type SmartKey } from "@/lib/segments";

type FormState = { error?: string; ok?: string } | undefined;

export type SegmentSummary = {
  settings: SegmentSettings; customers: number; buyers: number; revenue: number; p90_spend: number | null;
  segments: { key: SmartKey; count: number; reachable: number; spent: number }[];
};
export type SegmentMember = {
  customer_id: string; name: string | null; phone_e164: string; orders: number; spent: number; first_buy: string | null; last_buy: string | null;
  last_inbound: string | null; birthday: string | null; opted_in: boolean; opted_out: boolean; lead_id: string | null; lead_no: number | null;
};

export async function getSegmentSummary(): Promise<{ error?: string; data?: SegmentSummary }> {
  const { profile } = await requireProfile();
  if (!can(profile, "campaigns.manage")) return { error: "You need the “Create campaigns & segments” permission." };
  const { data, error } = await (await createClient()).rpc("lb_customer_segments");
  if (error) return { error: errMsg(error) };
  const d = data as SegmentSummary;
  return { data: { ...d, settings: { ...DEFAULT_SEGMENT_SETTINGS, ...d.settings } } };
}

export async function getSegmentMembers(key: string, limit = 200): Promise<{ error?: string; rows?: SegmentMember[] }> {
  const { profile } = await requireProfile();
  if (!can(profile, "campaigns.manage")) return { error: "No access" };
  if (!isSmartKey(key)) return { error: "Unknown segment" };
  const { data, error } = await (await createClient()).rpc("lb_customer_segment_members", { p_key: key, p_limit: limit });
  if (error) return { error: errMsg(error) };
  return { rows: (data ?? []) as SegmentMember[] };
}

const Days = z.coerce.number().int().min(1).max(3650);
const SettingsSchema = z.object({
  vip_min_spend: z.coerce.number().min(0).max(1e12), vip_min_orders: z.coerce.number().int().min(1).max(1000),
  repeat_min_orders: z.coerce.number().int().min(2).max(1000), new_buyer_days: Days, at_risk_days: Days, inactive_days: Days,
});

export async function saveSegmentSettings(_: FormState, form: FormData): Promise<FormState> {
  await requireProfile();
  const p = SettingsSchema.safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return { error: "Check the numbers: days 1-3650, repeat buyers need 2+ purchases." };
  const { error } = await (await createClient()).rpc("lb_save_customer_segment_settings", { p: p.data });
  if (error) return { error: errMsg(error) };
  revalidatePath("/whatsapp/segments");
  return { ok: "Segment rules saved." };
}
