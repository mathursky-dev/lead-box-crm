import type { createClient } from "@/lib/supabase/server";
import type { PoProduct } from "./po-form";

type Sb = Awaited<ReturnType<typeof createClient>>;

/** Vendors + products for the PO form. Cost/stock columns are optional (older databases). */
export async function poFormData(sb: Sb, company: string) {
  const [vR, pR] = await Promise.all([
    sb.from("lb_vendors").select("id,name,is_active").eq("company_id", company).order("name"),
    sb.from("lb_products").select("id,name,unit,cost_price,stock_qty").eq("company_id", company).eq("is_active", true).order("name"),
  ]);
  let products = (pR.data ?? []) as PoProduct[];
  if (pR.error) {
    const r = await sb.from("lb_products").select("id,name").eq("company_id", company).eq("is_active", true).order("name");
    products = ((r.data ?? []) as { id: string; name: string }[]).map((p) => ({ ...p, unit: "", cost_price: null, stock_qty: null }));
  }
  return { vendorsError: vR.error?.message ?? null, vendors: (vR.data ?? []) as { id: string; name: string; is_active: boolean }[], products };
}
