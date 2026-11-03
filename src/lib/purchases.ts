// Shared (client + server) bits of vendors and purchase orders (Store → Purchase orders / Vendors).

export const PO_STATUSES = [
  { value: "draft", label: "Draft", cls: "bg-slate-100 text-slate-700" },
  { value: "ordered", label: "Ordered", cls: "bg-blue-100 text-blue-800" },
  { value: "partial", label: "Part received", cls: "bg-amber-100 text-amber-800" },
  { value: "received", label: "Received", cls: "bg-green-100 text-green-800" },
  { value: "cancelled", label: "Cancelled", cls: "bg-slate-200 text-slate-500" },
] as const;
export const poStatus = (v: string) => PO_STATUSES.find((s) => s.value === v) ?? PO_STATUSES[0];

export type Vendor = {
  id: string; name: string; contact_person: string; phone_e164: string | null; email: string; gstin: string; address: string;
  payment_terms: string; notes: string; is_active: boolean;
};
export const VENDOR_COLS = "id,name,contact_person,phone_e164,email,gstin,address,payment_terms,notes,is_active";

export type PurchaseOrder = {
  id: string; po_no: number; vendor_id: string; status: string; order_date: string; expected_date: string | null;
  subtotal: number; tax: number; other_charges: number; total: number; received_value: number; amount_paid: number;
  notes: string; created_at: string; received_at: string | null;
};
export const PO_COLS = "id,po_no,vendor_id,status,order_date,expected_date,subtotal,tax,other_charges,total,received_value,amount_paid,notes,created_at,received_at";

export type PoItem = { id: string; product_id: string | null; name: string; unit: string; qty: number; received_qty: number; unit_cost: number; gst_pct: number };
export const PO_ITEM_COLS = "id,product_id,name,unit,qty,received_qty,unit_cost,gst_pct";

/** Line for the PO form (client) and the lb_save_po payload. */
export type PoLine = { product_id: string; name: string; unit: string; qty: number; unit_cost: number; gst_pct: number };

export const lineAmount = (l: { qty: number; unit_cost: number; gst_pct: number }) => {
  const base = Number(l.qty || 0) * Number(l.unit_cost || 0);
  return { base, tax: Math.round(base * Number(l.gst_pct || 0)) / 100 };
};
export function poTotals(lines: PoLine[], other = 0) {
  let subtotal = 0, tax = 0;
  for (const l of lines) { const a = lineAmount(l); subtotal += a.base; tax += a.tax; }
  return { subtotal, tax, total: subtotal + tax + Number(other || 0) };
}

/** Balance still to pay the vendor for a PO (on goods received, or the full PO when nothing is received yet). */
export const poDue = (po: Pick<PurchaseOrder, "status" | "total" | "received_value" | "amount_paid">) =>
  po.status === "cancelled" ? Math.max(0, po.received_value - po.amount_paid) : Math.max(0, (po.status === "partial" || po.status === "received" ? po.received_value : po.total) - po.amount_paid);

export const poLabel = (n: number) => `PO-${String(n).padStart(4, "0")}`;

export const GST_RATES = [0, 5, 12, 18, 28];
