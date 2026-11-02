import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { VENDOR_COLS, poDue, type PurchaseOrder, type Vendor } from "@/lib/purchases";
import { VendorsView } from "./vendors";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const { profile } = await requireAdmin();
  const sb = await createClient();
  const [vR, pR] = await Promise.all([
    sb.from("lb_vendors").select(VENDOR_COLS).eq("company_id", profile.company_id).order("is_active", { ascending: false }).order("name"),
    sb.from("lb_purchase_orders").select("vendor_id,status,total,received_value,amount_paid").eq("company_id", profile.company_id).limit(5000),
  ]);
  if (vR.error) return <ErrorBox message={/lb_vendors|schema cache/.test(vR.error.message) ? "Vendors are not set up yet: run the purchase-orders SQL once in Supabase." : vR.error.message} />;
  const stats = new Map<string, { pos: number; bought: number; due: number }>();
  for (const po of (pR.data ?? []) as Pick<PurchaseOrder, "vendor_id" | "status" | "total" | "received_value" | "amount_paid">[]) {
    const s = stats.get(po.vendor_id) ?? { pos: 0, bought: 0, due: 0 };
    s.pos += 1; s.bought += Number(po.received_value); s.due += poDue({ ...po, total: Number(po.total), received_value: Number(po.received_value), amount_paid: Number(po.amount_paid) });
    stats.set(po.vendor_id, s);
  }
  const rows = ((vR.data ?? []) as Vendor[]).map((v) => ({ ...v, ...(stats.get(v.id) ?? { pos: 0, bought: 0, due: 0 }) }));
  return <VendorsView rows={rows} />;
}
