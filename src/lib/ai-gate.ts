import "server-only";
import type { createAdminClient } from "./supabase/server";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Server-side (service role) check that a company may use AI right now: AI switched on in
 * Admin → Settings, not suspended, and "ai" in its plan. Same rule as lb_my_features:
 * internal / no plan = every feature; otherwise the plan's list.
 */
export async function companyAiAllowed(db: Db, companyId: string) {
  const { data: co } = await db.from("lb_companies").select("ai_enabled").eq("id", companyId).maybeSingle();
  if (!co?.ai_enabled) return false;
  return companyHasFeature(db, companyId, "ai");
}

export async function companyHasFeature(db: Db, companyId: string, feature: string) {
  const { data: b } = await db.from("lb_billing").select("plan,plan_id,suspended_at").eq("company_id", companyId).maybeSingle();
  if (b?.suspended_at) return false;
  if (b && b.plan !== "internal" && b.plan_id) {
    const { data: p } = await db.from("lb_plans").select("features").eq("id", b.plan_id).maybeSingle();
    if (!((p?.features ?? []) as string[]).includes(feature)) return false;
  }
  return true;
}
