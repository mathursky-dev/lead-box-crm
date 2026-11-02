import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { apiAuth, apiError } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/meta: names to use in other calls (statuses, sources, products, tags, users). */
export async function GET(req: NextRequest) {
  const key = await apiAuth(req, "leads.read");
  if (key instanceof NextResponse) return key;
  const db = createAdminClient();
  const co = key.company_id;
  const [st, src, pr, tg, us, cf] = await Promise.all([
    db.from("lb_lead_statuses").select("name,category,sort_order").eq("company_id", co).eq("is_active", true).order("sort_order"),
    db.from("lb_sources").select("name").eq("company_id", co).eq("is_active", true).order("name"),
    db.from("lb_products").select("name").eq("company_id", co).eq("is_active", true).order("name"),
    db.from("lb_tags").select("name").eq("company_id", co).order("name"),
    db.from("lb_profiles").select("full_name,email,role").eq("company_id", co).eq("is_active", true).neq("role", "super_admin").order("full_name"),
    db.from("lb_custom_fields").select("key,label,field_type,options,is_required").eq("company_id", co).eq("entity", "lead").eq("is_active", true).order("sort_order"),
  ]);
  const err = st.error ?? src.error ?? pr.error ?? tg.error ?? us.error;
  if (err) return apiError(400, err.message);
  return NextResponse.json({
    statuses: (st.data ?? []).map((s) => ({ name: s.name, category: s.category })),
    sources: (src.data ?? []).map((s) => s.name),
    products: (pr.data ?? []).map((s) => s.name),
    tags: (tg.data ?? []).map((s) => s.name),
    users: (us.data ?? []).map((u) => ({ name: u.full_name, email: u.email, role: u.role })),
    custom_fields: cf.error ? [] : (cf.data ?? []),
  });
}
