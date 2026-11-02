"use server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Per-user saved settings (lb_user_prefs). Each user can only read and write
// their own rows (RLS), so the layout follows them to every device.

const LeadTable = z.object({
  v: z.literal(1),
  cols: z.array(z.object({ k: z.string().max(40), on: z.boolean() })).max(60),
});
export type LeadTableLayout = z.infer<typeof LeadTable>;

export async function saveLeadTableLayout(layout: LeadTableLayout | null): Promise<{ error?: string }> {
  return saveTableLayout("leads.table", layout);
}

// Every list that has a "Customize Table" button saves its layout under one of these keys.
const TABLE_KEYS = ["leads.table", "tasks.table"] as const;
export type TableKey = (typeof TABLE_KEYS)[number];

export async function saveTableLayout(key: TableKey, layout: LeadTableLayout | null): Promise<{ error?: string }> {
  const { profile } = await requireProfile();
  if (!TABLE_KEYS.includes(key)) return { error: "Invalid table" };
  const sb = await createClient();
  if (layout === null) {
    const { error } = await sb.from("lb_user_prefs").delete().eq("user_id", profile.id).eq("key", key);
    return error ? { error: error.message } : {};
  }
  const parsed = LeadTable.safeParse(layout);
  if (!parsed.success) return { error: "Invalid layout" };
  const { error } = await sb.from("lb_user_prefs")
    .upsert({ user_id: profile.id, key, value: parsed.data, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  return error ? { error: error.message } : {};
}

// Status cards on the leads page: which statuses are pinned (null = all) and whether the cards are hidden.
const LeadCards = z.object({ v: z.literal(1), pinned: z.array(z.string().uuid()).max(100).nullable(), hidden: z.boolean() });
export type LeadCardsPref = z.infer<typeof LeadCards>;

export async function saveLeadCardsPref(pref: LeadCardsPref): Promise<{ error?: string }> {
  const { profile } = await requireProfile();
  const parsed = LeadCards.safeParse(pref);
  if (!parsed.success) return { error: "Invalid settings" };
  const sb = await createClient();
  const { error } = await sb.from("lb_user_prefs")
    .upsert({ user_id: profile.id, key: "leads.cards", value: parsed.data, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  return error ? { error: error.message } : {};
}

// Saved filter tabs on the leads page ("Filter By Reports"): a name + the query string.
const LeadViews = z.object({
  v: z.literal(1),
  views: z.array(z.object({ id: z.string().max(40), name: z.string().trim().min(1).max(40), qs: z.string().max(1500) })).max(20),
});
export type LeadViews = z.infer<typeof LeadViews>;

export async function saveLeadViews(pref: LeadViews): Promise<{ error?: string }> {
  const { profile } = await requireProfile();
  const parsed = LeadViews.safeParse(pref);
  if (!parsed.success) return { error: "Invalid saved filters" };
  const sb = await createClient();
  const { error } = await sb.from("lb_user_prefs")
    .upsert({ user_id: profile.id, key: "leads.views", value: parsed.data, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  return error ? { error: error.message } : {};
}
