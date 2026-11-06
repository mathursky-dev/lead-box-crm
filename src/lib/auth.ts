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
  // A platform Super Admin can open any company from the top bar (lb_switch_company). The database
  // already scopes them to it (lb_my_company), so the app uses the same company everywhere.
  const homeCompanyId = profile.company_id as string;
  if (profile.role === "super_admin") {
    const { data: acting } = await supabase.rpc("lb_my_company");
    if (typeof acting === "string" && acting) profile.company_id = acting;
  }
  const { data: effective } = await supabase.rpc("lb_my_permissions");
  const { data: company } = await supabase.from("lb_companies").select("id,name,auto_create_leads,auto_allocate").eq("id", profile.company_id).single();
  const { data: billing } = await supabase.from("lb_billing").select("plan,plan_id,trial_ends_at,paid_until,suspended_at").eq("company_id", profile.company_id).maybeSingle();
  // Entitlement is decided by the database clock (lb_access_ok), never the client.
  const { data: entitled } = await supabase.rpc("lb_access_ok");
  const { data: features } = await supabase.rpc("lb_my_features");
  return { uid, profile: { ...profile, effective: (effective ?? []) as Permission[] } as Profile, homeCompanyId, company, billing: billing as Billing | null, entitled: entitled === true,
    features: (features ?? ["nurture", "ai", "fb_leads"]) as string[] };
});

export type Billing = { plan: "trial" | "paid" | "internal"; plan_id: string | null; trial_ends_at: string; paid_until: string | null; suspended_at: string | null };

/** Signed-in, active profile whose company has a live trial or paid period. */
export async function requireProfile({ allowUnpaid = false } = {}) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.profile) redirect("/login?error=no_access");
  const gate = await twoFactorGate();
  if (gate) redirect(gate);
  // Company marked Inactive by the platform owner: no CRM pages at all, not even billing.
  if (s.billing?.suspended_at && s.profile.role !== "super_admin") redirect("/login?error=company_inactive");
  if (!s.entitled && !allowUnpaid) redirect("/billing");
  return { profile: s.profile, company: s.company!, billing: s.billing, entitled: s.entitled, features: s.features ?? [],
    /** The signed-in user's own company; differs from profile.company_id while a Super Admin has another company open. */
    homeCompanyId: s.homeCompanyId ?? s.profile.company_id };
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

// ---------------------------------------------------------- page-wise access (Agent / Team Leader)
import { allowed, type PageAccess, type PageAction } from "./page-access";

/** Pages this user is limited on (empty object = full access, always empty for admins). */
export const getPageAccess = cache(async (): Promise<PageAccess> => {
  const s = await getSession();
  if (!s?.profile || isAdmin(s.profile)) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lb_my_page_access");
  // Before the SQL is applied the function is missing: keep today's behaviour (full access).
  if (error || !data || typeof data !== "object") return {};
  return data as PageAccess;
});

/** For server actions: an error message when the role may not do this on the page, else null. */
export async function pageBlocked(page: string, action: PageAction = "edit"): Promise<string | null> {
  const access = await getPageAccess();
  if (allowed(access, page, action)) return null;
  return action === "delete" ? "Your role is not allowed to delete here. Ask your admin." : action === "edit" ? "Your role can only view this page. Ask your admin for edit access." : "Your role does not have access to this page.";
}

// ---------------------------------------------------------- two-factor (authenticator OTP)
/**
 * Where to send the user before any app page: "/two-factor" when they have 2FA on but have not entered the
 * code in this session, "/two-factor?setup=1" when their company makes 2FA compulsory and they have not set it
 * up yet; null when nothing is needed. Users without 2FA in a company that does not require it are never affected.
 */
export const twoFactorGate = cache(async (): Promise<string | null> => {
  const s = await getSession();
  if (!s?.profile) return null;
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal1" && aal.nextLevel === "aal2") return "/two-factor";
  if (aal?.currentLevel === "aal2" || s.profile.role === "super_admin") return null;
  // Compulsory 2FA is a setting of the user's own company (tolerates the column not existing yet).
  const { data: co, error } = await supabase.from("lb_companies").select("require_2fa,is_demo").eq("id", s.profile.company_id).maybeSingle();
  if (error || !co?.require_2fa || co.is_demo) return null;
  return "/two-factor?setup=1";
});
