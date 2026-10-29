import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { getSession } from "./auth";

export type Opt = { id: string; name: string; is_active?: boolean };
export type StatusOpt = { id: string; name: string; category: string; sort_order: number; is_active: boolean; is_default: boolean };
export type SubStatusOpt = { id: string; name: string; status_id: string | null; sort_order: number; is_active: boolean };
export type UserOpt = { id: string; full_name: string; role: string; team_id: string | null; is_active: boolean };

/** Reference data for the caller's company, cached per request.
 *  Filtered by company explicitly: RLS lets a super_admin read every company's rows. */
export const loadRefs = cache(async () => {
  const sb = await createClient();
  const cid = (await getSession())?.profile?.company_id ?? "00000000-0000-0000-0000-000000000000";
  const [branches, departments, teams, products, sources, tags, statuses, subStatuses, users, numbers] = await Promise.all([
    sb.from("lb_branches").select("id,name,is_active").eq("company_id", cid).order("name"),
    sb.from("lb_departments").select("id,name,is_active,branch_id").eq("company_id", cid).order("name"),
    sb.from("lb_teams").select("id,name,is_active,branch_id,department_id").eq("company_id", cid).order("name"),
    sb.from("lb_products").select("id,name,is_active").eq("company_id", cid).order("name"),
    sb.from("lb_sources").select("id,name,is_active,is_system").eq("company_id", cid).order("name"),
    sb.from("lb_tags").select("id,name,color").eq("company_id", cid).order("name"),
    sb.from("lb_lead_statuses").select("id,name,category,sort_order,is_active,is_default").eq("company_id", cid).order("sort_order"),
    sb.from("lb_lead_sub_statuses").select("id,name,status_id,sort_order,is_active").eq("company_id", cid).order("sort_order").order("name"),
    sb.from("lb_profiles").select("id,full_name,role,team_id,is_active").eq("company_id", cid).order("full_name"),
    sb.from("lb_wa_numbers").select("id,label,display_phone,status,is_active").eq("company_id", cid).order("label"),
  ]);
  return {
    branches: (branches.data ?? []) as Opt[],
    departments: (departments.data ?? []) as (Opt & { branch_id: string | null })[],
    teams: (teams.data ?? []) as (Opt & { branch_id: string | null; department_id: string | null })[],
    products: (products.data ?? []) as Opt[],
    sources: (sources.data ?? []) as (Opt & { is_system: boolean })[],
    tags: (tags.data ?? []) as { id: string; name: string; color: string }[],
    statuses: (statuses.data ?? []) as StatusOpt[],
    subStatuses: (subStatuses.data ?? []) as SubStatusOpt[],
    users: (users.data ?? []) as UserOpt[],
    numbers: (numbers.data ?? []) as { id: string; label: string; display_phone: string | null; status: string; is_active: boolean }[],
  };
});

export type Refs = Awaited<ReturnType<typeof loadRefs>>;
