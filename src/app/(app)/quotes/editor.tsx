"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { saveQuote } from "@/lib/actions/quotes";
import { KIND_LABEL, inr, lineAmount, totals, type QuoteItem, type QuoteKind } from "@/lib/quotes";

type Init = {
  id?: string; lead_id: string; kind: QuoteKind; doc_no?: string; issue_date: string; valid_until: string | null;
  items: QuoteItem[]; discount: number; notes: string; terms: string;
};

const blank = (tax: number): QuoteItem => ({ name: "", description: "", qty: 1, rate: 0, tax_pct: tax });

/** Quotation / invoice builder: line items, GST per line, flat discount, live totals. */
export function QuoteEditor({ init, lead, products, defaultTax }: {
  init: Init; lead: { id: string; no: number; name: string; phone: string }; products: string[]; defaultTax: number;
}) {
  const router = useRouter();
  const [f, setF] = useState(init);
  const [items, setItems] = useState<QuoteItem[]>(init.items.length ? init.items : [blank(defaultTax)]);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const t = useMemo(() => totals(items.filter((i) => i.name.trim()), f.discount), [items, f.discount]);
  const set = (i: number, patch: Partial<QuoteItem>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const label = KIND_LABEL[f.kind];

  const save = () => start(async () => {
    setErr("");
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

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-navy-900">Items</div>
        <datalist id="lb-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="divide-y divide-slate-100">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 p-3">
              <div className="col-span-12 space-y-1.5 md:col-span-5">
                <input className="input" list="lb-products" placeholder="Item / service name" value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Item name" />
                <input className="input text-xs" placeholder="Description (optional)" value={it.description} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" />
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
          <Row k="GST" v={inr(t.tax_total)} />
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
