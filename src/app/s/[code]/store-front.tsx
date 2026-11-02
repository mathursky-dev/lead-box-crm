"use client";
/* eslint-disable @next/next/no-img-element -- product photos are public Supabase Storage URLs */
import { useEffect, useMemo, useState, useTransition } from "react";
import { placeOrder } from "@/lib/actions/public-store";
import { onColor } from "@/lib/settings-shared";
import { rupees } from "@/lib/store";

export type ShopItem = { id: string; name: string; price: number; mrp: number | null; description: string; image: string | null; category: string; unit: string; inStock: boolean };
type Store = { name: string; tagline: string; color: string; minOrder: number; deliveryFee: number; freeAbove: number | null; askAddress: boolean; checkoutNote: string; thankYou: string };
type Cart = Record<string, number>;

export function StoreFront({ code, store, items, open, wa }: { code: string; store: Store; items: ShopItem[]; open: boolean; wa: string | null }) {
  const KEY = `lb-cart-${code}`;
  const [cart, setCart] = useState<Cart>({});
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [view, setView] = useState<ShopItem | null>(null);
  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", note: "", website: "" });
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ orderNo: number; total: number; lines: string } | null>(null);
  const [pending, start] = useTransition();
  const fg = onColor(store.color);

  // Cart survives a refresh (per store); storage can be unavailable (private mode).
  useEffect(() => { try { const c = JSON.parse(localStorage.getItem(KEY) ?? "{}"); if (c && typeof c === "object") setCart(c); } catch { /* ignore */ } }, [KEY]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* ignore */ } }, [KEY, cart]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = Object.entries(cart).map(([id, qty]) => ({ item: byId.get(id), qty })).filter((l): l is { item: ShopItem; qty: number } => Boolean(l.item?.inStock) && l.qty > 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.item.price, 0);
  const fee = store.freeAbove != null && subtotal >= store.freeAbove ? 0 : store.deliveryFee;
  const short = Math.max(0, store.minOrder - subtotal);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items]);
  const term = q.trim().toLowerCase();
  const shown = items.filter((i) => (!cat || i.category === cat) && (!term || `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(term)));

  const setQty = (id: string, qty: number) => setCart((c) => { const n = { ...c }; if (qty <= 0) delete n[id]; else n[id] = Math.min(qty, 999); return n; });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    start(async () => {
      const r = await placeOrder(code, { ...form, items: lines.map((l) => ({ id: l.item.id, qty: l.qty })) });
      if (r?.error) { setError(r.error); return; }
      setDone({ orderNo: r?.orderNo ?? 0, total: r?.total ?? subtotal + fee, lines: lines.map((l) => `${l.qty} × ${l.item.name}`).join("\n") });
      setCart({}); setSheet(false);
    });
  }

  if (done) {
    const msg = `Hi ${store.name}, I just placed order #${done.orderNo} (${rupees(done.total)}):\n${done.lines}`;
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white text-center shadow-xl">
          <div className="px-6 py-8" style={{ background: store.color, color: fg }}>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white/25 text-3xl">✓</div>
            <h1 className="text-xl font-bold">Order #{done.orderNo} placed</h1>
            <p className="mt-1 text-sm opacity-90">{rupees(done.total)}</p>
          </div>
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-600">{store.thankYou}</p>
            {wa && (
              <a href={`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-white shadow hover:brightness-95">
                <WaIcon /> Send order on WhatsApp
              </a>
            )}
            <button type="button" onClick={() => setDone(null)} className="text-sm font-medium text-slate-500 underline">Continue shopping</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-28">
      <header className="px-4 pb-6 pt-8" style={{ background: store.color, color: fg }}>
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-extrabold sm:text-3xl">{store.name}</h1>
          {store.tagline && <p className="mt-1 text-sm opacity-90">{store.tagline}</p>}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products"
            className="mt-4 w-full rounded-xl border-0 bg-white px-4 py-2.5 text-sm text-slate-800 shadow outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-white/60" />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4">
        {!open && <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">This store is not taking orders right now. You can still browse.</div>}
        {cats.length > 0 && (
          <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {["", ...cats].map((c) => (
              <button key={c || "all"} type="button" onClick={() => setCat(c)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${cat === c ? "border-transparent text-white" : "border-slate-200 bg-white text-slate-600"}`}
                style={cat === c ? { background: store.color, color: fg } : undefined}>{c || "All"}</button>
            ))}
          </div>
        )}

        {!shown.length ? (
          <p className="py-16 text-center text-sm text-slate-500">{items.length ? "No products match your search." : "Products will appear here soon."}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((i) => (
              <article key={i.id} className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
                <button type="button" onClick={() => setView(i)} className="block aspect-square w-full bg-slate-50" aria-label={`View ${i.name}`}>
                  {i.image ? <img src={i.image} alt={i.name} loading="lazy" className="h-full w-full object-cover" />
                    : <span className="grid h-full place-items-center text-4xl font-bold text-slate-300">{i.name.slice(0, 1)}</span>}
                </button>
                <div className="flex flex-1 flex-col p-3">
                  <button type="button" onClick={() => setView(i)} className="text-left text-sm font-semibold leading-snug text-slate-800 line-clamp-2">{i.name}</button>
                  {i.unit && <span className="text-xs text-slate-500">{i.unit}</span>}
                  <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
                    <span className="text-sm font-bold text-slate-900">{rupees(i.price)}</span>
                    {i.mrp != null && i.mrp > i.price && <>
                      <span className="text-xs text-slate-400 line-through">{rupees(i.mrp)}</span>
                      <span className="text-[11px] font-bold text-green-700">{Math.round((1 - i.price / i.mrp) * 100)}% off</span>
                    </>}
                  </div>
                  <div className="mt-auto pt-2"><QtyControl item={i} qty={cart[i.id] ?? 0} setQty={setQty} color={store.color} fg={fg} disabled={!open} /></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {count > 0 && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3">
          <button type="button" onClick={() => setSheet(true)} className="mx-auto flex w-full max-w-md items-center justify-between rounded-2xl px-5 py-3.5 text-sm font-bold shadow-xl" style={{ background: store.color, color: fg }}>
            <span>{count} item{count > 1 ? "s" : ""} · {rupees(subtotal)}</span><span>View cart →</span>
          </button>
        </div>
      )}

      {view && (
        <Sheet onClose={() => setView(null)} title={view.name}>
          {view.image && <img src={view.image} alt={view.name} className="mb-3 max-h-80 w-full rounded-xl object-contain bg-slate-50" />}
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold">{rupees(view.price)}</span>
            {view.mrp != null && view.mrp > view.price && <span className="text-sm text-slate-400 line-through">{rupees(view.mrp)}</span>}
            {view.unit && <span className="text-sm text-slate-500">· {view.unit}</span>}
          </div>
          {view.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{view.description}</p>}
          <div className="mt-4"><QtyControl item={view} qty={cart[view.id] ?? 0} setQty={setQty} color={store.color} fg={fg} disabled={!open} /></div>
        </Sheet>
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(false)} title="Your cart">
          {!lines.length ? <p className="py-6 text-center text-sm text-slate-500">Your cart is empty.</p> : (
            <form onSubmit={submit} className="space-y-4">
              <ul className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <li key={l.item.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.item.name}</p>
                      <p className="text-xs text-slate-500">{rupees(l.item.price)} × {l.qty} = <b>{rupees(l.item.price * l.qty)}</b></p>
                    </div>
                    <QtyControl item={l.item} qty={l.qty} setQty={setQty} color={store.color} fg={fg} small />
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{rupees(subtotal)}</dd></div>
                <div className="flex justify-between"><dt>Delivery</dt><dd>{fee ? rupees(fee) : "Free"}</dd></div>
                {store.freeAbove != null && fee > 0 && <p className="text-xs text-green-700">Add {rupees(store.freeAbove - subtotal)} more for free delivery</p>}
                <div className="flex justify-between border-t pt-1 font-bold"><dt>Total</dt><dd>{rupees(subtotal + fee)}</dd></div>
              </dl>
              <div className="grid gap-3">
                <input required maxLength={120} className="input" placeholder="Your name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input required inputMode="tel" maxLength={20} className="input" placeholder="WhatsApp number" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                {store.askAddress && <textarea required maxLength={500} rows={2} className="input" placeholder="Delivery address" autoComplete="street-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}
                <input maxLength={300} className="input" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                <input tabIndex={-1} aria-hidden="true" autoComplete="off" className="hidden" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
              {store.checkoutNote && <p className="whitespace-pre-line rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{store.checkoutNote}</p>}
              {short > 0 && <p className="text-sm text-red-600">Minimum order is {rupees(store.minOrder)}. Add {rupees(short)} more.</p>}
              {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={pending || short > 0 || !open} className="w-full rounded-xl px-4 py-3 text-sm font-bold shadow disabled:opacity-50" style={{ background: store.color, color: fg }}>
                {pending ? "Placing order…" : `Place order · ${rupees(subtotal + fee)}`}
              </button>
            </form>
          )}
        </Sheet>
      )}
    </main>
  );
}

function QtyControl({ item, qty, setQty, color, fg, small, disabled }: { item: ShopItem; qty: number; setQty: (id: string, q: number) => void; color: string; fg: string; small?: boolean; disabled?: boolean }) {
  if (!item.inStock) return <span className="block rounded-lg bg-slate-100 py-1.5 text-center text-xs font-semibold text-slate-500">Out of stock</span>;
  if (!qty) return (
    <button type="button" disabled={disabled} onClick={() => setQty(item.id, 1)} className="w-full rounded-lg py-1.5 text-sm font-bold disabled:opacity-50" style={{ background: color, color: fg }}>Add</button>
  );
  return (
    <div className={`flex items-center justify-between rounded-lg border border-slate-200 ${small ? "w-24" : "w-full"}`}>
      <button type="button" onClick={() => setQty(item.id, qty - 1)} className="px-3 py-1 text-lg font-bold text-slate-600" aria-label="Remove one">−</button>
      <span className="text-sm font-bold">{qty}</span>
      <button type="button" onClick={() => setQty(item.id, qty + 1)} className="px-3 py-1 text-lg font-bold text-slate-600" aria-label="Add one">+</button>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="truncate text-base font-bold text-slate-800">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full px-2 text-xl text-slate-500 hover:bg-slate-100" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const WaIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2c.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" /></svg>
);
