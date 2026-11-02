"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { saveQuote } from "@/lib/actions/quotes";
import { KIND_LABEL, inr, lineAmount, totals, type QuoteItem, type QuoteKind } from "@/lib/quotes";
import { STATES, UQC, stateOfGstin, validGstin } from "@/lib/gst";

export type GstInit = {
  buyer_gstin: string; buyer_legal_name: string; buyer_address: string; buyer_pincode: string; place_of_supply: string; reverse_charge: boolean;
};
type Init = {
  id?: string; lead_id: string; kind: QuoteKind; doc_no?: string; issue_date: string; valid_until: string | null;
  items: QuoteItem[]; discount: number; notes: string; terms: string;
} & GstInit;
export type HsnMemory = Record<string, { hsn?: string; unit?: string }>;

const blank = (tax: number): QuoteItem => ({ name: "", description: "", qty: 1, rate: 0, tax_pct: tax });

/** Quotation / invoice builder: line items, GST per line, flat discount, live totals. */
export function QuoteEditor({ init, lead, products, defaultTax, sellerState = null, hsnMemory = {} }: {
  init: Init; lead: { id: string; no: number; name: string; phone: string }; products: string[]; defaultTax: number;
  sellerState?: string | null; hsnMemory?: HsnMemory;
}) {
  const router = useRouter();
  const [f, setF] = useState(init);
  const [items, setItems] = useState<QuoteItem[]>(init.items.length ? init.items : [blank(defaultTax)]);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const t = useMemo(() => totals(items.filter((i) => i.name.trim()), f.discount), [items, f.discount]);
  const set = (i: number, patch: Partial<QuoteItem>) => setItems((xs) => xs.map((x, k) => {
    if (k !== i) return x;
    const next = { ...x, ...patch };
    // Picking a product used before fills its HSN / unit.
    const mem = patch.name !== undefined ? hsnMemory[patch.name.trim().toLowerCase()] : undefined;
    if (mem && !x.hsn && mem.hsn) next.hsn = mem.hsn;
    if (mem && !x.unit && mem.unit) next.unit = mem.unit;
    return next;
  }));
  const gstinOk = !f.buyer_gstin || validGstin(f.buyer_gstin);
  const pos = f.place_of_supply || stateOfGstin(f.buyer_gstin) || sellerState || "";
  const inter = Boolean(sellerState && pos && pos !== sellerState);
  const label = KIND_LABEL[f.kind];

  const save = () => start(async () => {
    setErr("");
    if (!gstinOk) { setErr("Fix the buyer GSTIN or leave it empty."); return; }
    const r = await saveQuote({ ...f, items });
    if (r.error) { setErr(r.error); return; }
    router.push(`/quotes/${r.id}?saved=1`);
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{init.id ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}</div>
          <h1 className="text-xl font-semibold text-navy-900">{init.doc_no ?? `${label} (number on save)`}</h1>
          <div className="text-sm text-slate-600">For <Link className="text-brand-700 hover:underline" href={`/leads/${lead.id}`}>LB-{lead.no}</Link> · {lead.name || "Customer"} · {lead.phone}</div>
        </div>
        {!init.id && (
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
            {(["quotation", "invoice"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setF({ ...f, kind: k })}
                className={`rounded-md px-3 py-1.5 ${f.kind === k ? "bg-navy-900 text-white" : "text-slate-600"}`}>{KIND_LABEL[k]}</button>
            ))}
          </div>
        )}
      </div>

      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <label className="block"><span className="label">Date</span>
          <input type="date" className="input" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></label>
        <label className="block"><span className="label">{f.kind === "quotation" ? "Valid till" : "Due date"}</span>
          <input type="date" className="input" value={f.valid_until ?? ""} onChange={(e) => setF({ ...f, valid_until: e.target.value || null })} /></label>
      </div>

      <details className="card group" open={f.kind === "invoice" || Boolean(init.buyer_gstin)}>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-navy-900">
          GST details <span className="font-normal text-slate-500">· {f.buyer_gstin ? `B2B, GSTIN ${f.buyer_gstin}` : "B2C (no buyer GSTIN)"}{pos ? ` · ${inter ? "IGST" : "CGST + SGST"}` : ""}</span>
        </summary>
        <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
          <label className="block"><span className="label">Buyer GSTIN (optional)</span>
            <input className={`input font-mono uppercase ${gstinOk ? "" : "border-red-400"}`} maxLength={15} placeholder="e.g. 27AAPFU0939F1ZV" value={f.buyer_gstin}
              onChange={(e) => setF({ ...f, buyer_gstin: e.target.value.toUpperCase().replace(/\s/g, "") })} />
            {!gstinOk && <span className="text-xs text-red-600">This GSTIN doesn&apos;t look right (check digit fails).</span>}</label>
          <label className="block"><span className="label">Buyer legal / business name</span>
            <input className="input" maxLength={100} placeholder={lead.name || "As per GST registration"} value={f.buyer_legal_name} onChange={(e) => setF({ ...f, buyer_legal_name: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">Billing address</span>
            <input className="input" maxLength={300} value={f.buyer_address} onChange={(e) => setF({ ...f, buyer_address: e.target.value })} /></label>
          <label className="block"><span className="label">PIN code</span>
            <input className="input" inputMode="numeric" maxLength={6} value={f.buyer_pincode} onChange={(e) => setF({ ...f, buyer_pincode: e.target.value.replace(/\D/g, "") })} /></label>
          <label className="block"><span className="label">Place of supply</span>
            <select className="input" value={f.place_of_supply} onChange={(e) => setF({ ...f, place_of_supply: e.target.value })}>
              <option value="">Auto ({pos ? `${pos} · ${STATES[pos]}` : "set your state in Settings"})</option>
              {Object.entries(STATES).map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
            </select></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.reverse_charge} onChange={(e) => setF({ ...f, reverse_charge: e.target.checked })} /> Reverse charge applies</label>
        </div>
      </details>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-navy-900">Items</div>
        <datalist id="lb-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="divide-y divide-slate-100">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 p-3">
              <div className="col-span-12 space-y-1.5 md:col-span-5">
                <input className="input" list="lb-products" placeholder="Item / service name" value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Item name" />
                <input className="input text-xs" placeholder="Description (optional)" value={it.description} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" />
                <div className="flex gap-1.5">
                  <input className="input w-32 text-xs" inputMode="numeric" placeholder="HSN / SAC" value={it.hsn ?? ""} maxLength={8}
                    onChange={(e) => set(i, { hsn: e.target.value.replace(/\D/g, "") })} aria-label="HSN or SAC code" />
                  <select className="input w-24 px-1 text-xs" value={it.unit ?? ""} onChange={(e) => set(i, { unit: e.target.value || undefined })} aria-label="Unit">
                    <option value="">Unit</option>{UQC.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <label className="col-span-3 md:col-span-1"><span className="label">Qty</span>
                <input className="input" type="number" min={0} step="any" value={it.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} /></label>
              <label className="col-span-4 md:col-span-2"><span className="label">Rate (₹)</span>
                <input className="input" type="number" min={0} step="0.01" value={it.rate} onChange={(e) => set(i, { rate: Number(e.target.value) })} /></label>
              <label className="col-span-3 md:col-span-1"><span className="label">GST %</span>
                <select className="input px-1" value={it.tax_pct} onChange={(e) => set(i, { tax_pct: Number(e.target.value) })}>
                  {Array.from(new Set([0, 5, 12, 18, 28, it.tax_pct])).sort((a, b) => a - b).map((x) => <option key={x} value={x}>{x}%</option>)}
                </select></label>
              <div className="col-span-2 flex items-end justify-end gap-2 md:col-span-3">
                <div className="pb-2 text-right text-sm font-semibold text-navy-900">{inr(lineAmount(it))}</div>
                <button type="button" className="mb-1 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove item" disabled={items.length === 1}
                  onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}><Icon name="trash" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 p-3">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setItems((xs) => [...xs, blank(defaultTax)])}><Icon name="plus" /> Add item</button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3 p-4">
          <label className="block"><span className="label">Notes (shown on PDF)</span>
            <textarea className="input min-h-20" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          <label className="block"><span className="label">Terms &amp; conditions</span>
            <textarea className="input min-h-24" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></label>
        </div>
        <div className="card space-y-2 p-4 text-sm">
          <Row k="Subtotal" v={inr(t.subtotal)} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600">Discount (₹)</span>
            <input className="input max-w-32 text-right" type="number" min={0} step="0.01" value={f.discount} onChange={(e) => setF({ ...f, discount: Number(e.target.value) })} aria-label="Discount" />
          </div>
          {t.tax_total > 0 && sellerState && pos
            ? (inter ? <Row k="IGST" v={inr(t.tax_total)} /> : <><Row k="CGST" v={inr(Math.round(t.tax_total * 50) / 100)} /><Row k="SGST" v={inr(t.tax_total - Math.round(t.tax_total * 50) / 100)} /></>)
            : <Row k="GST" v={inr(t.tax_total)} />}
          <div className="flex justify-between border-t pt-2 text-base font-semibold text-navy-900"><span>Total</span><span>{inr(t.total)}</span></div>
          {err && <div role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <Link className="btn-ghost" href={init.id ? `/quotes/${init.id}` : `/leads/${lead.id}`}>Cancel</Link>
            <button className="btn-primary" disabled={pending} onClick={save}>{pending ? "Saving…" : `Save ${label.toLowerCase()}`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span className="text-slate-600">{k}</span><span>{v}</span></div>;
