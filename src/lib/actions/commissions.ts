"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import type { FormState } from "@/components/ui";

// Agent commissions. Reads use the user's RLS; every write is admin-only and goes
// through the service role with an explicit company filter.

const Uuid = z.uuid();
const num = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : NaN;
};

async function admin() {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return { error: "Only admins can change commissions." } as const;
  if (!hasServiceRole()) return { error: "The server is not configured (service role key)." } as const;
  return { profile };
}
const touch = () => { revalidatePath("/commissions"); };

export async function saveCommissionSettings(_: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  const pct = num(form.get("default_pct"), 100), flat = num(form.get("flat_per_deal"), 10_000_000);
  if (Number.isNaN(pct) || Number.isNaN(flat)) return { error: "Commission % must be 0–100 and the flat amount 0 or more." };
  const enabled = form.get("enabled") === "on";
  const { error } = await createAdminClient().from("lb_commission_settings").upsert({
    company_id: a.profile.company_id, enabled, default_pct: pct ?? 0, flat_per_deal: flat ?? 0, updated_at: new Date().toISOString(),
  }, { onConflict: "company_id" });
  if (error) return { error: errMsg(error) };
  touch();
  return { ok: enabled ? "Saved. New won deals get a commission automatically." : "Saved. Commissions are off." };
}

/** Per-agent rate. Empty % and flat = use the company default. */
export async function saveAgentRate(userId: string, pctRaw: string, flatRaw: string): Promise<FormState> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  if (!Uuid.safeParse(userId).success) return { error: "Invalid user" };
  const pct = num(pctRaw, 100), flat = num(flatRaw, 10_000_000);
  if (Number.isNaN(pct) || Number.isNaN(flat)) return { error: "Commission % must be 0–100 and the flat amount 0 or more." };
  const db = createAdminClient();
  const { data: u } = await db.from("lb_profiles").select("id").eq("id", userId).eq("company_id", a.profile.company_id).maybeSingle();
  if (!u) return { error: "User not found" };
  const { error } = pct == null && flat == null
    ? await db.from("lb_commission_rates").delete().eq("company_id", a.profile.company_id).eq("user_id", userId)
    : await db.from("lb_commission_rates").upsert({ company_id: a.profile.company_id, user_id: userId, pct, flat, updated_at: new Date().toISOString() }, { onConflict: "company_id,user_id" });
  if (error) return { error: errMsg(error) };
  touch();
  return { ok: "Saved" };
}

/** Adds / refreshes pending commissions for deals won since a date (uses the current rates). */
export async function backfillCommissions(from: string): Promise<FormState> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Pick a start date." };
  const { data, error } = await (await createClient()).rpc("lb_commission_backfill", { p_from: from });
  if (error) return { error: errMsg(error) };
  touch();
  return { ok: `Checked ${data ?? 0} won deal(s). Approved / paid / edited commissions were not changed.` };
}

export async function setCommissionStatus(ids: string[], status: "approved" | "paid" | "pending" | "cancelled", ref = ""): Promise<FormState> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  const list = (Array.isArray(ids) ? ids : []).filter((id) => Uuid.safeParse(id).success).slice(0, 500);
  if (!list.length) return { error: "Select at least one commission." };
  if (!["approved", "paid", "pending", "cancelled"].includes(status)) return { error: "Invalid status" };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "approved") Object.assign(patch, { approved_by: a.profile.id, approved_at: now });
  if (status === "paid") Object.assign(patch, { paid_at: now, paid_ref: String(ref ?? "").trim().slice(0, 100) || null });
  if (status === "pending") Object.assign(patch, { approved_by: null, approved_at: null, paid_at: null, paid_ref: null });
  let q = createAdminClient().from("lb_commissions").update(patch).eq("company_id", a.profile.company_id).in("id", list);
  // Only sensible moves: pay approved or pending ones, never re-open a cancelled one as paid.
  if (status === "paid") q = q.in("status", ["pending", "approved"]);
  if (status === "approved") q = q.eq("status", "pending");
  if (status === "cancelled") q = q.in("status", ["pending", "approved"]);
  const { data, error } = await q.select("id");
  if (error) return { error: errMsg(error) };
  touch();
  return { ok: `${data?.length ?? 0} commission(s) marked ${status}.` };
}

/** Admin changes the amount (bonus / deduction). The trigger then leaves this row alone. */
export async function editCommission(id: string, amountRaw: string, note: string): Promise<FormState> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  if (!Uuid.safeParse(id).success) return { error: "Invalid commission" };
  const amount = num(amountRaw, 100_000_000);
  if (amount == null || Number.isNaN(amount)) return { error: "Enter an amount (0 or more)." };
  const { data, error } = await createAdminClient().from("lb_commissions")
    .update({ amount: Math.round(amount * 100) / 100, manual: true, note: String(note ?? "").trim().slice(0, 300), updated_at: new Date().toISOString() })
    .eq("id", id).eq("company_id", a.profile.company_id).neq("status", "paid").select("id");
  if (error) return { error: errMsg(error) };
  if (!data?.length) return { error: "A paid commission can't be edited." };
  touch();
  return { ok: "Saved" };
}
