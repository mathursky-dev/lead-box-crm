"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/ui";
import { Icon } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { updateOrder } from "@/lib/actions/store";
import { CHANNEL_LABEL, ORDER_STATUSES, PAYMENT_STATUSES, orderStatus, paymentStatus, rupees, type Order } from "@/lib/store";

/** Store link with copy / open / share-on-WhatsApp. */
export function StoreLink({ code, name, active, admin }: { code: string; name: string; active: boolean; admin: boolean }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/s/${code}`;
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const share = `https://wa.me/?text=${encodeURIComponent(`🛍️ ${name}: browse our catalog and order here ${url}`)}`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#25D366]/15 text-[#128C7E]"><Icon name="link" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Store link {active ? "" : "· switched off"}</p>
        <a href={`/s/${code}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-brand-700 hover:underline">{url.replace(/^https?:\/\//, "")}</a>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn-ghost btn-sm">{copied ? "Copied ✓" : "Copy link"}</button>
        <a href={share} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">Share on WhatsApp</a>
        {admin && <Link href="/store/settings" className="btn-ghost btn-sm">Settings</Link>}
      </div>
      <p className="w-full text-xs text-slate-500">Tip: in the inbox type <b>/store</b> to send this link in a chat.</p>
    </div>
  );
}

export function OrdersView({ rows, total, page, per, sp, open }: { rows: Order[]; total: number; page: number; per: number; sp: Record<string, string>; open: Order | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Order | null>(open);
  const [q, setQ] = useState(sp.q ?? "");
  const pages = Math.max(1, Math.ceil(total / per));
  useEffect(() => setSel(open), [open]);
  useEffect(() => setQ(sp.q ?? ""), [sp.q]);

  function href(p: Record<string, string>) {
    const u = new URLSearchParams({ ...sp, ...p });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    const s = u.toString();
    return `/store${s ? `?${s}` : ""}`;
  }
  const go = (p: Record<string, string>) => start(() => router.replace(href(p)));
  useEffect(() => {
    if (q === (sp.q ?? "")) return;
    const t = setTimeout(() => go({ q, page: "" }), 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = (k: string, v: string, label: string) => (
    <button key={k + v} type="button" onClick={() => go({ [k]: sp[k] === v ? "" : v, page: "" })}
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${sp[k] === v ? "border-transparent bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{label}</button>
  );

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order no., name, phone" className="input max-w-64 flex-1" aria-label="Search orders" />
        {pill("status", "open", "Open")}
        {ORDER_STATUSES.map((s) => pill("status", s.value, s.label))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {pill("pay", "unpaid", "Unpaid")}{pill("pay", "paid", "Paid")}
        <select className="input max-w-44" value={sp.channel ?? ""} onChange={(e) => go({ channel: e.target.value, page: "" })} aria-label="Channel">
          <option value="">All channels</option>
          {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {pending && <span className="text-xs text-slate-400">Loading…</span>}
      </div>
      {!rows.length ? (
        <p className="p-10 text-center text-sm text-slate-500">No orders {Object.keys(sp).length ? "match these filters" : "yet. Share your store link on WhatsApp to get the first one"}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">Order</th><th className="th">Customer</th><th className="th">Items</th><th className="th">Total</th>
              <th className="th">Status</th><th className="th">Payment</th><th className="th">Channel</th><th className="th">Placed</th>
            </tr></thead>
            <tbody className="divide-y">
              {rows.map((o) => {
                const s = orderStatus(o.status), p = paymentStatus(o.payment_status);
                return (
                  <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(o)}>
                    <td className="td font-semibold text-navy-900">#{o.order_no}</td>
                    <td className="td"><div className="font-medium">{o.name ?? "—"}</div><div className="text-xs text-slate-500">{o.phone_e164}</div></td>
                    <td className="td max-w-64 truncate text-slate-600">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</td>
                    <td className="td font-semibold">{rupees(o.total)}</td>
                    <td className="td"><span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${s.cls}`}>{s.label}</span></td>
                    <td className="td"><span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${p.cls}`}>{p.label}</span></td>
                    <td className="td text-xs text-slate-500">{CHANNEL_LABEL[o.channel] ?? o.channel}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDateTime(o.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        <span>{total} order{total === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>‹ Prev</button>
          Page {page} of {pages}
          <button type="button" className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>Next ›</button>
        </span>
      </div>
      {sel && <OrderModal order={sel} onClose={() => setSel(null)} />}
    </section>
  );
}

function OrderModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(o.status);
  const [pay, setPay] = useState(o.payment_status);
  const [note, setNote] = useState(o.staff_note ?? "");
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>();
  const [pending, start] = useTransition();
  const phone = o.phone_e164.replace(/\D/g, "");
  const summary = `Hi ${o.name ?? ""}, your order #${o.order_no} (${rupees(o.total)}) is ${orderStatus(status).label.toLowerCase()}.`;
  const save = () => start(async () => {
    const r = await updateOrder(o.id, status, pay, note);
    setMsg(r ?? {});
    if (r?.ok) router.refresh();
  });
  return (
    <Modal open onClose={onClose} title={`Order #${o.order_no}`} wide>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-navy-900">{o.name ?? "—"}</p>
            <p className="text-slate-500">{o.phone_e164}</p>
            {o.address && <p className="mt-1 whitespace-pre-line text-slate-600">📍 {o.address}</p>}
            {o.note && <p className="mt-1 whitespace-pre-line text-slate-600">📝 {o.note}</p>}
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>{CHANNEL_LABEL[o.channel] ?? o.channel}</p><p>{fmtDateTime(o.created_at)}</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th text-right">Amount</th></tr></thead>
          <tbody className="divide-y">
            {o.items.map((i, n) => (
              <tr key={n}><td className="td">{i.name}{i.sku && <span className="ml-1 text-xs text-slate-400">{i.sku}</span>}</td>
                <td className="td text-right">{i.qty}</td><td className="td text-right">{rupees(i.price)}</td><td className="td text-right">{rupees(i.amount)}</td></tr>
            ))}
          </tbody>
          <tfoot className="text-right">
            {Number(o.delivery_fee) > 0 && <tr><td className="td" colSpan={3}>Delivery</td><td className="td">{rupees(o.delivery_fee)}</td></tr>}
            <tr className="font-bold"><td className="td" colSpan={3}>Total</td><td className="td">{rupees(o.total)}</td></tr>
          </tfoot>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Order status</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{ORDER_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          </label>
          <label className="block"><span className="label">Payment</span>
            <select className="input" value={pay} onChange={(e) => setPay(e.target.value)}>{PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          </label>
          <label className="block sm:col-span-2"><span className="label">Staff note (not shown to the customer)</span>
            <textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {msg?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{msg.error}</p>}
        {msg?.ok && <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-brand-700">{msg.ok}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {o.lead_id && <Link href={`/leads/${o.lead_id}`} className="btn-ghost btn-sm">Open lead</Link>}
            <a href={`https://wa.me/${phone}?text=${encodeURIComponent(summary)}`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">Update customer on WhatsApp</a>
          </div>
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
