import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { istDate } from "@/lib/dates";
import { PoForm } from "../po-form";
import { poFormData } from "../form-data";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrder({ searchParams }: { searchParams: Promise<{ vendor?: string }> }) {
  const { vendor } = await searchParams;
  const { profile } = await requireAdmin();
  const d = await poFormData(await createClient(), profile.company_id);
  if (d.vendorsError) return <ErrorBox message={/lb_vendors|schema cache/.test(d.vendorsError) ? "Purchase orders are not set up yet: run the purchase-orders SQL once in Supabase." : d.vendorsError} />;
  const vendors = d.vendors.filter((v) => v.is_active);
  return (
    <>
      <h2 className="mb-3 text-lg font-semibold text-navy-900">New purchase order</h2>
      <PoForm vendors={vendors} products={d.products}
        init={{ vendor_id: vendors.some((v) => v.id === vendor) ? vendor! : vendors.length === 1 ? vendors[0].id : "", order_date: istDate(), expected_date: "", other_charges: 0, notes: "", lines: [] }} />
    </>
  );
}
