import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PO_COLS, PO_ITEM_COLS, poLabel, type PoItem, type PurchaseOrder } from "@/lib/purchases";
import { PoForm } from "../../po-form";
import { poFormData } from "../../form-data";

export const metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireAdmin();
  const sb = await createClient();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [poR, itR] = await Promise.all([
    sb.from("lb_purchase_orders").select(PO_COLS).eq("id", id).eq("company_id", profile.company_id).maybeSingle(),
    sb.from("lb_po_items").select(PO_ITEM_COLS).eq("po_id", id).order("sort_order"),
  ]);
  const po = poR.data as PurchaseOrder | null;
  if (!po) notFound();
  const items = (itR.data ?? []) as PoItem[];
  if (!["draft", "ordered"].includes(po.status) || items.some((i) => i.received_qty > 0)) redirect(`/store/purchases/${id}`);
  const d = await poFormData(sb, profile.company_id);
  const vendors = d.vendors.filter((v) => v.is_active || v.id === po.vendor_id);
  return (
    <>
      <h2 className="mb-3 text-lg font-semibold text-navy-900">Edit {poLabel(po.po_no)}</h2>
      <PoForm vendors={vendors} products={d.products} init={{
        id: po.id, status: po.status, vendor_id: po.vendor_id, order_date: po.order_date, expected_date: po.expected_date ?? "",
        other_charges: Number(po.other_charges), notes: po.notes,
        lines: items.map((i) => ({ product_id: i.product_id ?? "", name: i.name, unit: i.unit, qty: i.qty, unit_cost: Number(i.unit_cost), gst_pct: Number(i.gst_pct) })),
      }} />
    </>
  );
}
