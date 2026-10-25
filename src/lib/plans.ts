import "server-only";
import { createAdminClient } from "./supabase/server";

export type Plan = {
  id: string; code: string; name: string; description: string | null;
  price_inr: number; per_user: boolean; period_days: number; trial_days: number;
  max_users: number | null; max_numbers: number | null; max_leads_month: number | null;
  features: string[]; is_public: boolean; is_active: boolean; sort: number;
};

/** Plan features a company can be switched on/off for. */
export const FEATURES: Record<string, string> = {
  nurture: "Marketing & nurture (campaigns, journeys)",
  ai: "AI replies & summaries",
  fb_leads: "Facebook Lead Ads",
};

/** Plans offered on signup and billing. Service role: the signup page is anonymous. */
export async function publicPlans() {
  const { data } = await createAdminClient().from("lb_plans").select("*").eq("is_active", true).eq("is_public", true).order("sort").order("price_inr");
  return (data ?? []) as Plan[];
}

export async function getPlan(id: string | null | undefined) {
  if (!id) return null;
  const { data } = await createAdminClient().from("lb_plans").select("*").eq("id", id).maybeSingle();
  return data as Plan | null;
}

export const priceFor = (plan: Pick<Plan, "price_inr" | "per_user">, seats: number) => plan.price_inr * (plan.per_user ? Math.max(1, seats) : 1);

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function periodLabel(days: number) {
  if (days % 365 === 0) return days === 365 ? "year" : `${days / 365} years`;
  if (days % 30 === 0) return days === 30 ? "month" : `${days / 30} months`;
  return `${days} days`;
}

/** "₹699 per user / month" style label. */
export const priceLabel = (p: Pick<Plan, "price_inr" | "per_user" | "period_days">) =>
  p.price_inr === 0 ? "Free" : `${inr(p.price_inr)}${p.per_user ? " per user" : ""} / ${periodLabel(p.period_days)}`;

export const limitLabel = (n: number | null) => (n == null ? "Unlimited" : n.toLocaleString("en-IN"));

export type BillingRow = {
  company_id: string; plan: "trial" | "paid" | "internal"; plan_id: string | null; trial_ends_at: string; paid_until: string | null;
  suspended_at: string | null; suspended_reason: string | null; notes: string | null; created_at: string;
};

export type Status = "suspended" | "internal" | "paid" | "trial" | "expired";

/** Same rule as lb_company_entitled() in the database. */
export function companyStatus(b: Pick<BillingRow, "plan" | "trial_ends_at" | "paid_until" | "suspended_at"> | null | undefined, now = Date.now()): Status {
  if (!b) return "expired";
  if (b.suspended_at) return "suspended";
  if (b.plan === "internal") return "internal";
  if (b.paid_until && new Date(b.paid_until).getTime() > now) return "paid";
  if (new Date(b.trial_ends_at).getTime() > now) return "trial";
  return "expired";
}

/** When access ends (null = never / already ended). */
export function accessEnds(b: Pick<BillingRow, "plan" | "trial_ends_at" | "paid_until">, s: Status) {
  return s === "paid" ? b.paid_until : s === "trial" ? b.trial_ends_at : null;
}

export const STATUS_BADGE: Record<Status, [string, string]> = {
  paid: ["Paid", "bg-brand-100 text-brand-700"],
  trial: ["Trial", "bg-sky-100 text-sky-700"],
  internal: ["Free forever", "bg-violet-100 text-violet-700"],
  expired: ["Expired", "bg-amber-100 text-amber-800"],
  suspended: ["Suspended", "bg-red-100 text-red-700"],
};
