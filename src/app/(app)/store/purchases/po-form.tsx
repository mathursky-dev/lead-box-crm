"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field } from "@/components/ui";
import { savePurchaseOrder } from "@/lib/actions/purchases";
import { rupees } from "@/lib/store";
import { GST_RATES, lineAmount, poTotals, type PoLine } from "@/lib/purchases";

export type PoProduct = { id: string; name: string; unit: string; cost_price: number | null; stock_qty: number | null };
type Init = { id?: string; vendor_id: string; order_date: string; expected_date: string; other_charges: number; notes: string; lines: PoLine[]; status?: string };

const blank = (): PoLine => ({ product_id: "", name: "", unit: "", qty: 1, unit_cost: 0, gst_pct: 0 });

export function PoForm({ vendors, products, init }: { vendors: { id: string; name: string }[]; products: PoProduct[]; init: Init }) {
  const router = useRouter();
  const [v, setV] = useState(init);
  const [lines, setLines] = useState<PoLine[]>(init.lines.length ? init.lines : [blank()]);
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const byId = new Map(products.map((p) => [p.id, p]));
  const t = poTotals(lines, v.other_charges);

  const setLine = (i: number, patch: Partial<PoLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickProduct = (i: number, id: string) => {
    const p = byId.get(id);
    setLine(i, p ? { product_id: id, name: p.name, unit: p.unit, ...(p.cost_price != null && !lines[i].unit_cost ? { unit_cost: Number(p.cost_price) } : {}) } : { product_id: "" });
  };

  function save(place: boolean) {
    setErr(undefined);
    start(async () => {
      const r = await savePurchaseOrder({ ...v, id: init.id ?? null, lines, place });
      if (r.error) { setErr(r.error); return; }
      router.push(`/store/purchases/${r.id}`);
      router.refresh();
    });
  }

  return (
    <section className="card space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Vendor">
          <select className="input" value={v.vendor_id} onChange={(e) => setV({ ...v, vendor_id: e.target.value })} required>
            <option value="">Pick a vendor…</option>
            {vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Order date"><input className="input" type="date" value={v.order_date} onChange={(e) => setV({ ...v, order_date: e.target.value })} /></Field>
        <Field label="Expected delivery"><input className="input" type="date" value={v.expected_date} onChange={(e) => setV({ ...v, expected_date: e.target.value })} /></Field>
      </div>
      {!vendors.length && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">No vendors yet. <Link href="/store/vendors" className="font-semibold underline">Add a vendor</Link> first.</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th w-[34%]">Product / item</th><th className="th">Unit</th><th className="th w-24 text-right">Qty</th><th className="th w-28 text-right">Cost / unit (₹)</th>
            <th className="th w-24">GST %</th><th className="th text-right">Amount</th><th className="th" />
          </tr></thead>
          <tbody className="divide-y">
            {lines.map((l, i) => { const a = lineAmount(l); const p = l.product_id ? byId.get(l.product_id) : null; return (
              <tr key={i}>
                <td className="td space-y-1">
                  <select className="input" value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)} aria-label={`Line ${i + 1} product`}>
                    <option value="">Other item (type name)…</option>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  {!l.product_id && <input className="input" placeholder="Item name" value={l.name} maxLength={160} onChange={(e) => setLine(i, { name: e.target.value })} aria-label={`Line ${i + 1} name`} />}
                  {p && <p className="text-xs text-slate-500">{p.stock_qty == null ? "Stock not tracked yet: receiving starts tracking it" : `${p.stock_qty} in stock now`}</p>}
                </td>
                <td className="td"><input className="input w-24" value={l.unit} maxLength={30} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label={`Line ${i + 1} unit`} /></td>
                <td className="td"><input className="input text-right" type="number" min={1} step={1} value={l.qty} onChange={(e) => setLine(i, { qty: Math.max(0, Math.floor(Number(e.target.value))) })} aria-label={`Line ${i + 1} quantity`} /></td>
                <td className="td"><input className="input text-right" type="number" min={0} step="0.01" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: Number(e.target.value) })} aria-label={`Line ${i + 1} cost`} /></td>
                <td className="td">
                  <select className="input" value={l.gst_pct} onChange={(e) => setLine(i, { gst_pct: Number(e.target.value) })} aria-label={`Line ${i + 1} GST`}>
                    {[...new Set([...GST_RATES, l.gst_pct])].map((g) => <option key={g} value={g}>{g}%</option>)}
                  </select>
                </td>
                <td className="td text-right font-medium">{rupees(a.base + a.tax)}</td>
                <td className="td text-right">
                  {lines.length > 1 && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</button>}
                </td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}>+ Add item</button>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Notes for the vendor" hint="Delivery address, brand, packing, etc.">
          <textarea className="input" rows={3} maxLength={2000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <dl className="grid grid-cols-2 content-start gap-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
          <dt className="text-slate-500">Subtotal</dt><dd className="text-right">{rupees(t.subtotal)}</dd>
          <dt className="text-slate-500">GST</dt><dd className="text-right">{rupees(t.tax)}</dd>
          <dt className="self-center text-slate-500">Freight / other charges</dt>
          <dd className="text-right"><input className="input ml-auto h-8 w-28 text-right" type="number" min={0} step="0.01" value={v.other_charges} onChange={(e) => setV({ ...v, other_charges: Number(e.target.value) })} aria-label="Other charges" /></dd>
          <dt className="border-t pt-1.5 font-semibold text-navy-900">Total</dt><dd className="border-t pt-1.5 text-right font-semibold text-navy-900">{rupees(t.total)}</dd>
        </dl>
      </div>

      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="flex flex-wrap gap-2">
        {(!init.status || init.status === "draft") && <button type="button" className="btn-primary" disabled={pending} onClick={() => save(true)}>{pending ? "Saving…" : "Save & mark ordered"}</button>}
        <button type="button" className={init.status && init.status !== "draft" ? "btn-primary" : "btn-ghost"} disabled={pending} onClick={() => save(false)}>{init.status && init.status !== "draft" ? "Save changes" : "Save as draft"}</button>
        <Link href={init.id ? `/store/purchases/${init.id}` : "/store/purchases"} className="btn-ghost">Cancel</Link>
      </div>
    </section>
  );
}
