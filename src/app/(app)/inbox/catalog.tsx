"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui";
import { rupees } from "@/lib/store";
import { chatCatalog, sendChatProducts, createChatOrder, type ChatProduct, type ChatStore, type PayMethod } from "@/lib/actions/chat-store";

/** 🛍️ in the chat composer: send Store products to the customer, or make an order and ask for payment. */
export function CatalogButton({ convId, disabled, onDone, onError }: { convId: string; disabled?: boolean; onDone: () => void; onError: (e?: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="px-1 py-1 text-lg text-slate-500" title="Send products / take order & payment" aria-label="Send products or take an order"
        disabled={disabled} onClick={() => { onError(undefined); setOpen(true); }}>🛍️</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Products & payment" wide>
        {open && <CatalogPanel convId={convId} onDone={() => { onDone(); }} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function CatalogPanel({ convId, onDone, onClose }: { convId: string; onDone: () => void; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [products, setProducts] = useState<ChatProduct[]>([]);
  const [store, setStore] = useState<ChatStore | null>(null);
  const [loadErr, setLoadErr] = useState<string>();
  const [tab, setTab] = useState<"send" | "order">("send");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"cards" | "catalog">("cards");
  const [note, setNote] = useState("");
  const [withLink, setWithLink] = useState(true);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pay, setPay] = useState<PayMethod>("none");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok?: string; error?: string; url?: string }>();

  useEffect(() => {
    let live = true;
    chatCatalog(convId).then((r) => {
      if (!live) return;
      if (r.error) { setLoadErr(r.error); setState("error"); return; }
      setProducts(r.products ?? []); setStore(r.store ?? null); setState("ready");
      const s = r.store;
      if (s) setPay(s.upi ? "upi" : s.razorpay ? "razorpay" : s.waPay ? "whatsapp_pay" : "none");
    }).catch(() => { if (live) { setLoadErr("Could not load products."); setState("error"); } });
    return () => { live = false; };
  }, [convId]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.filter((p) => (tab === "order" ? p.price != null : true) && (!t || `${p.name} ${p.sku ?? ""} ${p.category}`.toLowerCase().includes(t)));
  }, [products, q, tab]);
  const chosen = products.filter((p) => picked[p.id] > 0 && (tab === "send" || p.price != null));
  const subtotal = chosen.reduce((s, p) => s + (p.price ?? 0) * picked[p.id], 0);
  const autoFee = store ? (store.free_above != null && subtotal >= store.free_above ? 0 : store.delivery_fee) : 0;
  const fee = delivery === null ? autoFee : Math.max(0, Number(delivery) || 0);
  const toggle = (id: string) => setPicked((c) => { const n = { ...c }; if (n[id]) delete n[id]; else n[id] = 1; return n; });
  const setQty = (id: string, qty: number) => setPicked((c) => { const n = { ...c }; if (qty <= 0) delete n[id]; else n[id] = Math.min(qty, 999); return n; });

  if (state === "loading") return <div className="py-10 text-center text-sm text-slate-500">Loading products…</div>;
  if (state === "error") return <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadErr}</div>;
  if (res?.ok) {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-green-50 px-3 py-2 text-green-800">✅ {res.ok}</div>
        {res.url && <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={res.url} aria-label="Payment page" />
          <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(res.url!)}>Copy</button></div>}
        <p className="text-xs text-slate-500">The order is in <Link className="text-brand-700 underline" href="/store">Store → Orders</Link>. When payment comes in, it is marked Paid (Razorpay / WhatsApp Pay automatically; UPI after you check your bank).</p>
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => { setRes(undefined); setPicked({}); }}>Send more</button><button className="btn-primary" onClick={onClose}>Done</button></div>
      </div>
    );
  }
  if (!products.length) {
    return <div className="space-y-2 py-6 text-center text-sm text-slate-600">No products yet. <Link className="text-brand-700 underline" href="/store/products">Add products in Store → Products</Link></div>;
  }

  const submit = async () => {
    setBusy(true); setRes(undefined);
    const ids = chosen.map((p) => p.id);
    const r = tab === "send"
      ? await sendChatProducts(convId, ids, mode, note, withLink && Boolean(store?.code && store.active))
      : await createChatOrder(convId, { items: chosen.map((p) => ({ product_id: p.id, qty: picked[p.id] })), delivery: fee, note, address, pay });
    setBusy(false);
    if (r.error) { setRes({ error: r.error }); if (r.order_no) onDone(); return; }
    setRes({ ok: r.ok, url: r.url }); onDone();
  };

  const payOpts: { v: PayMethod; label: string; hint: string; on: boolean }[] = [
    { v: "upi", label: "UPI (GPay / PhonePe / Paytm)", hint: "Customer gets a pay page with QR and your UPI ID", on: Boolean(store?.upi) },
    { v: "razorpay", label: "Razorpay link", hint: "Card / UPI / netbanking, marked paid automatically", on: Boolean(store?.razorpay) },
    { v: "whatsapp_pay", label: "WhatsApp Pay (inside chat)", hint: "Review and Pay button in WhatsApp, marked paid automatically", on: Boolean(store?.waPay) },
    { v: "none", label: "No payment now (COD / later)", hint: "Only the bill is sent", on: true },
  ];

  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {([["send", "📤 Send products"], ["order", "🧾 Order & payment"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === k ? "bg-white text-navy-900 shadow-sm" : "text-slate-600"}`}
            onClick={() => { setTab(k); setRes(undefined); }}>{l}</button>
        ))}
      </div>
      {store && !store.payReady && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Chat payments need the new database update (Supabase SQL) once. Sending product photos still works after it.</div>}
      <input className="input" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
      <ul className="max-h-72 divide-y overflow-auto rounded-lg border">
        {list.map((p) => {
          const n = picked[p.id] ?? 0;
          return (
            <li key={p.id} className={`flex items-center gap-3 px-2 py-2 ${n ? "bg-brand-50/60" : ""}`}>
              {p.image ? <img src={p.image} alt="" className="h-11 w-11 shrink-0 rounded object-cover" /> : <div className="grid h-11 w-11 shrink-0 place-items-center rounded bg-slate-100 text-lg">📦</div>}
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(p.id)}>
                <div className="truncate font-medium text-navy-900">{p.name}</div>
                <div className="truncate text-xs text-slate-500">{p.price != null ? rupees(p.price) : "No price"}{p.unit ? ` / ${p.unit}` : ""}{p.sku ? ` · ${p.sku}` : ""}{!p.in_stock ? " · out of stock" : ""}</div>
              </button>
              {tab === "send" ? (
                <input type="checkbox" checked={n > 0} onChange={() => toggle(p.id)} aria-label={`Pick ${p.name}`} className="h-4 w-4" />
              ) : (
                <span className="flex items-center gap-1">
                  <button type="button" className="h-7 w-7 rounded border" onClick={() => setQty(p.id, n - 1)} aria-label="Less">−</button>
                  <span className="w-6 text-center">{n}</span>
                  <button type="button" className="h-7 w-7 rounded border" onClick={() => setQty(p.id, n + 1)} aria-label="More">+</button>
                </span>
              )}
            </li>
          );
        })}
        {!list.length && <li className="px-3 py-4 text-center text-slate-500">{tab === "order" ? "No priced products match." : "No products match."}</li>}
      </ul>

      {tab === "send" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "cards"} onChange={() => setMode("cards")} /> Photo cards (name, price, photo)</label>
            <label className={`flex items-center gap-1.5 ${store?.catalog ? "" : "text-slate-400"}`} title={store?.catalog ? "" : "Add your Meta catalog ID in Store → Settings"}>
              <input type="radio" disabled={!store?.catalog} checked={mode === "catalog"} onChange={() => setMode("catalog")} /> WhatsApp catalog (add to cart in WhatsApp)</label>
          </div>
          <textarea className="input" rows={2} maxLength={900} placeholder="Message with the products (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {store?.code && store.active && <label className="flex items-center gap-2"><input type="checkbox" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} /> Also send my store link to order online</label>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className="label">Delivery charge (₹)</span>
              <input className="input" type="number" min={0} step="0.01" value={delivery ?? String(autoFee)} onChange={(e) => setDelivery(e.target.value)} /></label>
            <label className="block"><span className="label">Delivery address (optional)</span>
              <input className="input" maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          </div>
          <input className="input" maxLength={1000} placeholder="Note on the order (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <fieldset className="space-y-1">
            <legend className="label">How will the customer pay?</legend>
            {payOpts.map((o) => (
              <label key={o.v} className={`flex items-start gap-2 rounded-md border px-2 py-1.5 ${pay === o.v ? "border-brand-500 bg-brand-50/50" : "border-slate-200"} ${o.on ? "" : "opacity-60"}`}>
                <input type="radio" className="mt-1" disabled={!o.on} checked={pay === o.v} onChange={() => setPay(o.v)} />
                <span><b>{o.label}</b><span className="block text-xs text-slate-500">{o.on ? o.hint : o.v === "razorpay" ? "Add Razorpay keys in Settings → Quotes & Payments" : "Set it up in Store → Settings"}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span>{chosen.length} item(s) · subtotal {rupees(subtotal)}{fee > 0 ? ` + delivery ${rupees(fee)}` : ""}</span><b>Total {rupees(subtotal + fee)}</b></div>
        </div>
      )}
      {res?.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{res.error}</div>}
      <div className="flex items-center justify-between gap-2">
        <Link href="/store/settings" className="text-xs text-brand-700 underline">Store payment settings</Link>
        <button className="btn-primary" disabled={busy || !chosen.length} onClick={submit}>
          {busy ? "Sending…" : tab === "send" ? `Send ${chosen.length || ""} product${chosen.length === 1 ? "" : "s"}` : `Create order & send bill`}
        </button>
      </div>
    </div>
  );
}
