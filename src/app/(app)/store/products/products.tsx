"use client";
/* eslint-disable @next/next/no-img-element -- product photos are public Supabase Storage URLs */
import { useState } from "react";
import { ActionButton, ActionForm, Field, Modal, Submit } from "@/components/ui";
import { getBrowserClient } from "@/lib/supabase/client";
import { saveProduct, setProductFlag, startProductImage } from "@/lib/actions/store";
import { STORE_BUCKET, rupees, type StoreProduct } from "@/lib/store";

type Row = StoreProduct & { image: string | null; stock_qty: number | null; low_stock_at: number };
const isLow = (p: Row) => p.stock_qty != null && p.stock_qty <= p.low_stock_at;

export function ProductsView({ rows, stockOn, initialOnly = "" }: { rows: Row[]; stockOn: boolean; initialOnly?: "" | "low" }) {
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "store" | "hidden" | "low">(initialOnly);
  const term = q.trim().toLowerCase();
  const shown = rows.filter((p) => (!term || `${p.name} ${p.sku ?? ""} ${p.category}`.toLowerCase().includes(term))
    && (only !== "store" || p.in_store) && (only !== "hidden" || !p.in_store) && (only !== "low" || isLow(p)));
  const low = rows.filter((p) => p.is_active && isLow(p)).length;
  const live = rows.filter((p) => p.in_store && p.is_active && p.price != null).length;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU, category" className="input max-w-64 flex-1" aria-label="Search products" />
        <select className="input max-w-44" value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label="Show">
          <option value="">All products ({rows.length})</option><option value="store">In store ({live})</option><option value="hidden">Not in store</option>
          {stockOn && <option value="low">Low / out of stock ({low})</option>}
        </select>
        <button type="button" className="btn-primary ml-auto" onClick={() => setEdit("new")}>+ Add product</button>
      </div>
      <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        These are the same products used on leads. Give a product a price and switch on <b>In store</b> to show it on your store link.
        Using a Meta (WhatsApp) catalog too? Put the item&apos;s <b>Content ID</b> in SKU so cart orders from WhatsApp map to the right product.
      </p>
      {stockOn && low > 0 && only !== "low" && (
        <button type="button" onClick={() => setOnly("low")} className="block w-full border-b border-red-100 bg-red-50 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-100">
          ⚠ {low} product{low === 1 ? " is" : "s are"} low or out of stock. <span className="font-semibold underline">Show</span>
        </button>
      )}
      {!shown.length ? <p className="p-10 text-center text-sm text-slate-500">{rows.length ? "No products match." : "No products yet. Add your first product."}</p> : (
        <ul className="divide-y">
          {shown.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center gap-3 p-3 ${p.is_active ? "" : "opacity-60"}`}>
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-lg font-bold text-slate-300">{p.name.slice(0, 1)}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => setEdit(p)} className="text-left font-semibold text-navy-900 hover:text-brand-700">{p.name}</button>
                <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{p.price != null ? rupees(p.price) : "No price"}</span>
                  {p.mrp != null && p.price != null && p.mrp > p.price && <span className="line-through">{rupees(p.mrp)}</span>}
                  {p.unit && <span>· {p.unit}</span>}{p.category && <span>· {p.category}</span>}{p.sku && <span>· SKU {p.sku}</span>}
                  {p.stock_qty != null && <span className={isLow(p) ? "font-semibold text-red-600" : "text-slate-600"}>· {p.stock_qty === 0 ? "0 left" : `${p.stock_qty} in stock`}{isLow(p) && p.stock_qty > 0 ? " (low)" : ""}</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <ActionButton action={() => setProductFlag(p.id, "in_store", !p.in_store)} className={`btn-sm rounded-full border ${p.in_store ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 text-slate-500"}`}>
                  {p.in_store ? "✓ In store" : "Not in store"}
                </ActionButton>
                <ActionButton action={() => setProductFlag(p.id, "in_stock", !p.in_stock)} className={`btn-sm rounded-full border ${p.in_stock ? "border-slate-200 text-slate-600" : "border-red-200 bg-red-50 text-red-700"}`}>
                  {p.in_stock ? "In stock" : "Out of stock"}
                </ActionButton>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(p)}>Edit</button>
                <ActionButton action={() => setProductFlag(p.id, "is_active", !p.is_active)}
                  confirm={p.is_active ? `Deactivate "${p.name}"? It disappears from the store and won't be offered for new leads.` : undefined}>
                  {p.is_active ? "Deactivate" : "Activate"}
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && <ProductForm p={edit === "new" ? null : edit} stockOn={stockOn} onClose={() => setEdit(null)} />}
    </section>
  );
}

function ProductForm({ p, stockOn, onClose }: { p: Row | null; stockOn: boolean; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<string | null>(p?.image ?? null);
  const [remove, setRemove] = useState(false);
  const [upErr, setUpErr] = useState<string>();
  const [uploading, setUploading] = useState(false);

  async function pick(f?: File) {
    if (!f) return;
    setUpErr(undefined); setUploading(true);
    try {
      const s = await startProductImage(f.name, f.size, f.type);
      if (s.error || !s.path || !s.token) { setUpErr(s.error ?? "Upload failed"); return; }
      const up = await getBrowserClient().storage.from(STORE_BUCKET).uploadToSignedUrl(s.path, s.token, f, { contentType: f.type });
      if (up.error) { setUpErr(`Upload failed: ${up.error.message}`); return; }
      setPath(s.path); setRemove(false); setPreview(URL.createObjectURL(f));
    } finally { setUploading(false); }
  }

  return (
    <Modal open onClose={onClose} title={p ? `Edit ${p.name}` : "Add product"} wide>
      <ActionForm action={saveProduct} onOk={onClose}>
        <input type="hidden" name="id" value={p?.id ?? ""} />
        <input type="hidden" name="image_path" value={path} />
        {remove && <input type="hidden" name="remove_image" value="on" />}
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
            {preview && !remove ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-xs text-slate-400">No photo</span>}
          </div>
          <div className="space-y-1 text-sm">
            <label className="btn-ghost btn-sm cursor-pointer">{uploading ? "Uploading…" : preview && !remove ? "Change photo" : "Upload photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            {preview && !remove && <button type="button" className="ml-2 text-xs text-red-600 underline" onClick={() => { setRemove(true); setPath(""); }}>Remove</button>}
            <p className="text-xs text-slate-500">JPG/PNG/WEBP, up to 5 MB. Square photos look best.</p>
            {upErr && <p role="alert" className="text-xs text-red-600">{upErr}</p>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className="input" name="name" defaultValue={p?.name ?? ""} required maxLength={100} /></Field>
          <Field label="Category" hint="Groups products on the store page"><input className="input" name="category" defaultValue={p?.category ?? ""} maxLength={60} /></Field>
          <Field label="Selling price (₹)"><input className="input" name="price" type="number" min={0} step="0.01" defaultValue={p?.price ?? ""} /></Field>
          <Field label="MRP (₹)" hint="Optional; shows a strike-through and % off"><input className="input" name="mrp" type="number" min={0} step="0.01" defaultValue={p?.mrp ?? ""} /></Field>
          <Field label="Unit" hint="e.g. 1 kg, per piece, 500 ml"><input className="input" name="unit" defaultValue={p?.unit ?? ""} maxLength={30} /></Field>
          <Field label="SKU / Meta Content ID"><input className="input" name="sku" defaultValue={p?.sku ?? ""} maxLength={100} /></Field>
          <Field label="Position" hint="Lower shows first"><input className="input" name="sort_order" type="number" min={0} defaultValue={p?.sort_order ?? 100} /></Field>
        </div>
        {stockOn && (
          <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
            <input type="hidden" name="stock_on" value="1" />
            <Field label="Stock quantity" hint="Leave empty to not track stock. Orders reduce it; at 0 the product shows Out of stock.">
              <input className="input" name="stock_qty" type="number" min={0} step={1} defaultValue={p?.stock_qty ?? ""} />
            </Field>
            <Field label="Alert when stock is at or below" hint="Admins get a bell + phone alert">
              <input className="input" name="low_stock_at" type="number" min={0} step={1} defaultValue={p?.low_stock_at ?? 5} />
            </Field>
          </div>
        )}
        <Field label="Description"><textarea className="input" name="description" rows={3} maxLength={2000} defaultValue={p?.description ?? ""} /></Field>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="in_store" defaultChecked={p ? p.in_store : true} /> Show in store</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="in_stock" defaultChecked={p ? p.in_stock : true} /> In stock</label>
        </div>
        <Submit>{uploading ? "Wait for the photo…" : "Save product"}</Submit>
      </ActionForm>
    </Modal>
  );
}
