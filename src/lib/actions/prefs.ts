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
  const { profile } = await requireProfile();
  const sb = await createClient();
  if (layout === null) {
    const { error } = await sb.from("lb_user_prefs").delete().eq("user_id", profile.id).eq("key", "leads.table");
    return error ? { error: error.message } : {};
  }
  const parsed = LeadTable.safeParse(layout);
  if (!parsed.success) return { error: "Invalid layout" };
  const { error } = await sb.from("lb_user_prefs")
    .upsert({ user_id: profile.id, key: "leads.table", value: parsed.data, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
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
