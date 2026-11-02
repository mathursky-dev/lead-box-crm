"use client";
import { useState } from "react";
import { ActionForm, Field, Submit } from "@/components/ui";
import { saveStore } from "@/lib/actions/store";
import { STORE_KEYWORDS } from "@/lib/store";

type Store = {
  code: string; name: string; tagline: string; color: string; wa_phone: string | null; min_order: number; delivery_fee: number;
  free_delivery_above: number | null; ask_address: boolean; checkout_note: string; thank_you: string; source_id: string | null; is_active: boolean;
};

export function StoreSettingsForm({ store, defaults, sources, autoReply }: {
  store: Store | null; defaults: { code: string; name: string; wa: string }; sources: { id: string; name: string }[]; autoReply: boolean;
}) {
  const [code, setCode] = useState(store?.code ?? defaults.code);
  const [color, setColor] = useState(store?.color ?? "#16a34a");
  const gen = () => setCode(Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join(""));
  return (
    <ActionForm action={saveStore} className="card max-w-3xl space-y-4 p-5">
      {!store && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">Set up your store once. After saving you get a link like <b>/s/{code}</b> to share on WhatsApp, status and Instagram bio.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Store name"><input className="input" name="name" required maxLength={80} defaultValue={store?.name ?? defaults.name} /></Field>
        <Field label="Link code" hint="Your store link is /s/CODE">
          <div className="flex gap-2">
            <input className="input font-mono uppercase" name="code" required pattern="[A-Za-z0-9]{4,12}" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="button" className="btn-ghost btn-sm" onClick={gen}>New</button>
          </div>
        </Field>
        <Field label="Tagline"><input className="input" name="tagline" maxLength={160} defaultValue={store?.tagline ?? ""} placeholder="Fresh bakes delivered same day" /></Field>
        <Field label="Theme colour">
          <div className="flex items-center gap-2">
            <input type="color" name="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 rounded border" aria-label="Theme colour" />
            <span className="font-mono text-xs text-slate-500">{color}</span>
          </div>
        </Field>
        <Field label="WhatsApp number for orders" hint="Digits with country code. Empty = your connected WhatsApp number.">
          <input className="input" name="wa_phone" inputMode="numeric" defaultValue={store?.wa_phone ?? ""} placeholder={defaults.wa || "919876543210"} />
        </Field>
        <Field label="Lead source for store orders" hint="Empty = “Mini-store”">
          <select className="input" name="source_id" defaultValue={store?.source_id ?? ""}>
            <option value="">Mini-store (auto)</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Minimum order (₹)"><input className="input" name="min_order" type="number" min={0} step="0.01" defaultValue={store?.min_order ?? 0} /></Field>
        <Field label="Delivery charge (₹)"><input className="input" name="delivery_fee" type="number" min={0} step="0.01" defaultValue={store?.delivery_fee ?? 0} /></Field>
        <Field label="Free delivery above (₹)" hint="Empty = never free"><input className="input" name="free_delivery_above" type="number" min={0} step="0.01" defaultValue={store?.free_delivery_above ?? ""} /></Field>
      </div>
      <Field label="Checkout note" hint="Shown above the Place order button, e.g. payment or delivery info">
        <textarea className="input" name="checkout_note" rows={2} maxLength={500} defaultValue={store?.checkout_note ?? ""} placeholder="Cash on delivery / UPI. Delivery in 2–3 days." />
      </Field>
      <Field label="Thank-you message"><input className="input" name="thank_you" maxLength={300} defaultValue={store?.thank_you ?? ""} placeholder="Thank you! Your order is placed. We will confirm it on WhatsApp shortly." /></Field>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="ask_address" defaultChecked={store?.ask_address ?? true} /> Ask for delivery address</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={store?.is_active ?? true} /> Store is taking orders</label>
        <label className="flex items-start gap-2"><input type="checkbox" name="auto_reply" defaultChecked={store ? autoReply : true} className="mt-0.5" />
          <span>Auto-reply the store link on WhatsApp when a customer writes <i>{STORE_KEYWORDS.slice(0, 4).join(", ")}</i>…</span></label>
      </div>
      <Submit>Save store</Submit>
    </ActionForm>
  );
}
