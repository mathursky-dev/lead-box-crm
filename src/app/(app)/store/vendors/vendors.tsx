"use client";
import Link from "next/link";
import { useState } from "react";
import { ActionButton, ActionForm, Field, Modal, Submit } from "@/components/ui";
import { saveVendor, setVendorActive } from "@/lib/actions/purchases";
import { rupees } from "@/lib/store";
import type { Vendor } from "@/lib/purchases";

type Row = Vendor & { pos: number; bought: number; due: number };

export function VendorsView({ rows }: { rows: Row[] }) {
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const shown = rows.filter((v) => !term || `${v.name} ${v.contact_person} ${v.phone_e164 ?? ""} ${v.gstin}`.toLowerCase().includes(term));
  const due = rows.reduce((s, v) => s + v.due, 0);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, GSTIN" className="input max-w-64 flex-1" aria-label="Search vendors" />
        {due > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">To pay vendors: {rupees(due)}</span>}
        <button type="button" className="btn-primary ml-auto" onClick={() => setEdit("new")}>+ Add vendor</button>
      </div>
      <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Suppliers you buy stock from. Create a <Link href="/store/purchases/new" className="font-semibold text-brand-700 underline">purchase order</Link> for a vendor; when the goods arrive, &ldquo;Receive&rdquo; adds the quantity to your store stock.
      </p>
      {!shown.length ? <p className="p-10 text-center text-sm text-slate-500">{rows.length ? "No vendors match." : "No vendors yet. Add your first supplier."}</p> : (
        <ul className="divide-y">
          {shown.map((v) => (
            <li key={v.id} className={`flex flex-wrap items-center gap-3 p-3 ${v.is_active ? "" : "opacity-60"}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-50 font-bold text-violet-700">{v.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => setEdit(v)} className="text-left font-semibold text-navy-900 hover:text-brand-700">{v.name}</button>
                <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                  {v.contact_person && <span>{v.contact_person}</span>}
                  {v.phone_e164 && <a className="hover:text-brand-700" href={`tel:${v.phone_e164}`}>{v.phone_e164}</a>}
                  {v.gstin && <span>· GSTIN {v.gstin}</span>}
                  {v.payment_terms && <span>· {v.payment_terms}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div><Link className="hover:text-brand-700" href={`/store/purchases?vendor=${v.id}`}>{v.pos} PO{v.pos === 1 ? "" : "s"}</Link> · bought {rupees(v.bought)}</div>
                {v.due > 0 && <div className="font-semibold text-amber-700">To pay {rupees(v.due)}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {v.is_active && <Link href={`/store/purchases/new?vendor=${v.id}`} className="btn-ghost btn-sm">+ PO</Link>}
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(v)}>Edit</button>
                <ActionButton action={() => setVendorActive(v.id, !v.is_active)} confirm={v.is_active ? `Hide "${v.name}"? Old purchase orders stay.` : undefined}>
                  {v.is_active ? "Hide" : "Activate"}
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && <VendorForm v={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function VendorForm({ v, onClose }: { v: Row | null; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={v ? `Edit ${v.name}` : "Add vendor"} wide>
      <ActionForm action={saveVendor} onOk={onClose}>
        <input type="hidden" name="id" value={v?.id ?? ""} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor / company name"><input className="input" name="name" defaultValue={v?.name ?? ""} required maxLength={120} /></Field>
          <Field label="Contact person"><input className="input" name="contact_person" defaultValue={v?.contact_person ?? ""} maxLength={100} /></Field>
          <Field label="Phone / WhatsApp" hint="Used to send the PO on WhatsApp"><input className="input" name="phone" type="tel" defaultValue={v?.phone_e164 ?? ""} maxLength={30} /></Field>
          <Field label="Email"><input className="input" name="email" type="email" defaultValue={v?.email ?? ""} maxLength={200} /></Field>
          <Field label="GSTIN"><input className="input uppercase" name="gstin" defaultValue={v?.gstin ?? ""} maxLength={15} /></Field>
          <Field label="Payment terms" hint="e.g. 30 days credit, advance"><input className="input" name="payment_terms" defaultValue={v?.payment_terms ?? ""} maxLength={100} /></Field>
        </div>
        <Field label="Address"><textarea className="input" name="address" rows={2} maxLength={500} defaultValue={v?.address ?? ""} /></Field>
        <Field label="Notes"><textarea className="input" name="notes" rows={2} maxLength={1000} defaultValue={v?.notes ?? ""} /></Field>
        <Submit>Save vendor</Submit>
      </ActionForm>
    </Modal>
  );
}
