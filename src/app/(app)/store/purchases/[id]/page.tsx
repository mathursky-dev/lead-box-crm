import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDay, fmtDateTime, istDate } from "@/lib/dates";
import { rupees } from "@/lib/store";
import { PO_COLS, PO_ITEM_COLS, VENDOR_COLS, lineAmount, poDue, poLabel, poStatus, type PoItem, type PurchaseOrder, type Vendor } from "@/lib/purchases";
import { PoActions } from "./po-actions";

export const metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

const day = (d?: string | null) => (d ? fmtDay(d + "T12:00:00Z") : "—");

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile, company } = await requireAdmin();
  const sb = await createClient();
  const { data } = await sb.from("lb_purchase_orders").select(PO_COLS).eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!data) notFound();
  const raw = data as PurchaseOrder;
  const po = { ...raw, subtotal: Number(raw.subtotal), tax: Number(raw.tax), other_charges: Number(raw.other_charges), total: Number(raw.total), received_value: Number(raw.received_value), amount_paid: Number(raw.amount_paid) };
  const [vR, itR, rcR] = await Promise.all([
    sb.from("lb_vendors").select(VENDOR_COLS).eq("id", po.vendor_id).maybeSingle(),
    sb.from("lb_po_items").select(PO_ITEM_COLS).eq("po_id", id).order("sort_order"),
    sb.from("lb_po_receipts").select("id,received_on,amount,lines,note,created_at").eq("po_id", id).order("id", { ascending: false }),
  ]);
  const vendor = vR.data as Vendor | null;
  const items = ((itR.data ?? []) as PoItem[]).map((i) => ({ ...i, unit_cost: Number(i.unit_cost), gst_pct: Number(i.gst_pct) }));
  const receipts = (rcR.data ?? []) as { id: number; received_on: string; amount: number; lines: { name: string; qty: number }[]; note: string; created_at: string }[];
  const st = poStatus(po.status);
  const due = poDue(po);
  const editable = (po.status === "draft" || po.status === "ordered") && !items.some((i) => i.received_qty > 0);

  // Text for "Send on WhatsApp" to the vendor.
  const waText = [
    `*Purchase order ${poLabel(po.po_no)}*`, `From: ${company?.name ?? ""}`, `Date: ${day(po.order_date)}`,
    po.expected_date ? `Delivery by: ${day(po.expected_date)}` : "", "",
    ...items.map((i, n) => `${n + 1}. ${i.name} × ${i.qty}${i.unit ? ` ${i.unit}` : ""} @ ${rupees(i.unit_cost)}${i.gst_pct ? ` + ${i.gst_pct}% GST` : ""}`),
    "", `Total: ${rupees(po.total)}`, po.notes ? `\nNote: ${po.notes}` : "",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/store/purchases" className="text-sm text-slate-500 hover:text-brand-700">← Purchase orders</Link>
      </div>
      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-navy-900">{poLabel(po.po_no)} <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${st.cls}`}>{st.label}</span></h2>
            <p className="text-sm text-slate-500">Ordered {day(po.order_date)}{po.expected_date ? ` · delivery by ${day(po.expected_date)}` : ""}{po.received_at ? ` · fully received ${fmtDateTime(po.received_at)}` : ""}</p>
          </div>
          <PoActions po={{ id: po.id, po_no: po.po_no, status: po.status, total: po.total, amount_paid: po.amount_paid, due }} editable={editable}
            items={items.filter((i) => i.received_qty < i.qty).map((i) => ({ id: i.id, name: i.name, unit: i.unit, left: i.qty - i.received_qty, tracked: !!i.product_id }))}
            today={istDate()} waPhone={vendor?.phone_e164?.replace(/\D/g, "") ?? null} waText={waText} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="text-xs font-semibold uppercase text-slate-400">Vendor</p>
            {vendor ? (<>
              <p className="font-semibold text-navy-900">{vendor.name}</p>
              {vendor.contact_person && <p>{vendor.contact_person}</p>}
              {vendor.phone_e164 && <p>{vendor.phone_e164}</p>}
              {vendor.email && <p>{vendor.email}</p>}
              {vendor.gstin && <p>GSTIN {vendor.gstin}</p>}
              {vendor.address && <p className="whitespace-pre-line text-slate-600">{vendor.address}</p>}
              {vendor.payment_terms && <p className="text-slate-500">Terms: {vendor.payment_terms}</p>}
            </>) : <p className="text-slate-500">—</p>}
          </div>
          <dl className="grid grid-cols-2 content-start gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <dt className="text-slate-500">Subtotal</dt><dd className="text-right">{rupees(po.subtotal)}</dd>
            <dt className="text-slate-500">GST</dt><dd className="text-right">{rupees(po.tax)}</dd>
            <dt className="text-slate-500">Freight / other</dt><dd className="text-right">{rupees(po.other_charges)}</dd>
            <dt className="border-t pt-1 font-semibold">Total</dt><dd className="border-t pt-1 text-right font-semibold">{rupees(po.total)}</dd>
            <dt className="text-slate-500">Goods received</dt><dd className="text-right">{rupees(po.received_value)}</dd>
            <dt className="text-slate-500">Paid to vendor</dt><dd className="text-right">{rupees(po.amount_paid)}</dd>
            <dt className="font-semibold text-amber-700">To pay</dt><dd className="text-right font-semibold text-amber-700">{rupees(due)}</dd>
          </dl>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">#</th><th className="th">Item</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th>
              <th className="th text-right">Cost / unit</th><th className="th text-right">GST</th><th className="th text-right">Amount</th>
            </tr></thead>
            <tbody className="divide-y">
              {items.map((i, n) => { const a = lineAmount(i); return (
                <tr key={i.id}>
                  <td className="td text-slate-400">{n + 1}</td>
                  <td className="td font-medium text-navy-900">{i.name}{i.unit && <span className="font-normal text-slate-500"> · {i.unit}</span>}{!i.product_id && <span className="ml-1 text-xs font-normal text-slate-400">(not a store product)</span>}</td>
                  <td className="td text-right">{i.qty}</td>
                  <td className={`td text-right ${i.received_qty >= i.qty ? "text-green-700" : i.received_qty ? "text-amber-700" : "text-slate-400"}`}>{i.received_qty}</td>
                  <td className="td text-right">{rupees(i.unit_cost)}</td>
                  <td className="td text-right">{i.gst_pct}%</td>
                  <td className="td text-right">{rupees(a.base + a.tax)}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        {po.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><b>Notes:</b> {po.notes}</p>}
      </section>

      <section className="card mt-4 p-4 print:hidden">
        <h3 className="mb-2 font-semibold text-navy-900">Goods received</h3>
        {!receipts.length ? <p className="text-sm text-slate-500">Nothing received yet. Use <b>Receive goods</b> when the delivery arrives: the quantity is added to store stock.</p> : (
          <ul className="divide-y text-sm">
            {receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-navy-900">{day(r.received_on)}</p>
                  <p className="text-xs text-slate-500">{r.lines.map((l) => `${l.name} × ${l.qty}`).join(", ")}{r.note ? ` · ${r.note}` : ""}</p>
                </div>
                <span className="font-semibold">{rupees(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Received value counts as purchase cost in <Link href="/profit-loss" className="underline">Profit &amp; Loss</Link> on the date received.</p>
      </section>
    </>
  );
}
