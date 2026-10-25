import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Role = "super_admin" | "company_admin" | "team_leader" | "agent";

export type Profile = {
  id: string;
  company_id: string;
  role: Role;
  full_name: string;
  email: string;
  phone: string | null;
  branch_id: string | null;
  department_id: string | null;
  team_id: string | null;
  permissions: string[];
  is_active: boolean;
  accepts_auto_allocation: boolean;
  allocation_limit: number | null;
  username?: string | null;
  /** Effective permissions (role matrix + per-user extras), from lb_my_permissions(). */
  effective: Permission[];
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  company_admin: "Company Admin",
  team_leader: "Team Leader",
  agent: "Agent",
};

export { PERMISSIONS, type Permission } from "./permissions";
import type { Permission } from "./permissions";

/** Current user + LEAD BOX profile, cached per request. Null if no active profile. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return null;
  const { data: profile } = await supabase.from("lb_profiles").select("*").eq("id", uid).maybeSingle();
  if (!profile || !profile.is_active) return { uid, profile: null as Profile | null };
  const { data: effective } = await supabase.rpc("lb_my_permissions");
  const { data: company } = await supabase.from("lb_companies").select("id,name,auto_create_leads,auto_allocate").eq("id", profile.company_id).single();
  const { data: billing } = await supabase.from("lb_billing").select("plan,plan_id,trial_ends_at,paid_until,suspended_at").eq("company_id", profile.company_id).maybeSingle();
  // Entitlement is decided by the database clock (lb_access_ok), never the client.
  const { data: entitled } = await supabase.rpc("lb_access_ok");
  const { data: features } = await supabase.rpc("lb_my_features");
  return { uid, profile: { ...profile, effective: (effective ?? []) as Permission[] } as Profile, company, billing: billing as Billing | null, entitled: entitled === true,
    features: (features ?? ["nurture", "ai", "fb_leads"]) as string[] };
});

export type Billing = { plan: "trial" | "paid" | "internal"; plan_id: string | null; trial_ends_at: string; paid_until: string | null; suspended_at: string | null };

/** Signed-in, active profile whose company has a live trial or paid period. */
export async function requireProfile({ allowUnpaid = false } = {}) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.profile) redirect("/login?error=no_access");
  if (!s.entitled && !allowUnpaid) redirect("/billing");
  return { profile: s.profile, company: s.company!, billing: s.billing, entitled: s.entitled, features: s.features ?? [] };
}

/** Plan features (lb_plans.features) for the signed-in company; internal companies have all of them. */
export async function hasFeature(feature: "nurture" | "ai" | "fb_leads") {
  const s = await getSession();
  return Boolean(s && "features" in s && s.features?.includes(feature));
}

export const isAdmin = (p: Pick<Profile, "role">) => p.role === "super_admin" || p.role === "company_admin";
export const isManager = (p: Pick<Profile, "role">) => isAdmin(p) || p.role === "team_leader";
export const can = (p: Profile, perm: Permission) => isAdmin(p) || p.effective.includes(perm);

export async function requireAdmin() {
  const s = await requireProfile();
  if (!isAdmin(s.profile)) redirect("/dashboard");
  return s;
}
