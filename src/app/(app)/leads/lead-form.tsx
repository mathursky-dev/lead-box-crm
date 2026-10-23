"use client";
import Link from "next/link";
import { useActionState, useRef } from "react";
import { Field, Submit, Alert } from "@/components/ui";
import { createLead } from "@/lib/actions/leads";
import type { Refs } from "@/lib/data";

type Props = { refs: Refs; canChooseOwner: boolean; defaults?: { phone?: string; name?: string }; repeatOf?: { lead_no: number } };

export function NewLeadForm({ refs, canChooseOwner, defaults, repeatOf }: Props) {
  const [state, run] = useActionState(createLead, undefined);
  const forceRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={run} className="card grid gap-3 p-5 sm:grid-cols-2">
      <input ref={forceRef} type="hidden" name="force_repeat" defaultValue={repeatOf ? "1" : "0"} />
      {repeatOf && <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 sm:col-span-2">Creating a new sales opportunity for the same customer (repeat of LB-{repeatOf.lead_no}).</p>}
      <Field label="Mobile / WhatsApp *" hint="Indian numbers can omit +91."><input className="input" name="phone" defaultValue={defaults?.phone} required inputMode="tel" readOnly={!!repeatOf} /></Field>
      <Field label="Customer name"><input className="input" name="name" defaultValue={defaults?.name} /></Field>
      <Field label="Email"><input className="input" type="email" name="email" /></Field>
      <Field label="Location"><input className="input" name="location" /></Field>
      <Field label="Product / Service"><select className="input" name="product_id"><option value="">—</option>{refs.products.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Source"><select className="input" name="source_id"><option value="">Manual</option>{refs.sources.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Branch"><select className="input" name="branch_id"><option value="">—</option>{refs.branches.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Department"><select className="input" name="department_id"><option value="">—</option>{refs.departments.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Priority"><select className="input" name="priority" defaultValue="normal">{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Expected value (₹)"><input className="input" type="number" min={0} step="0.01" name="expected_value" /></Field>
      {canChooseOwner && (
        <Field label="Owner" hint="Leave empty to auto-allocate by round-robin rules.">
          <select className="input" name="owner_id"><option value="">Auto-allocate</option>{refs.users.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
        </Field>
      )}
      <Field label="Next follow-up (IST)"><input className="input" type="datetime-local" name="next_followup_at" /></Field>
      {refs.tags.length > 0 && (
        <fieldset className="sm:col-span-2"><legend className="label">Tags</legend>
          <div className="flex flex-wrap gap-3">{refs.tags.map((t) => <label key={t.id} className="flex items-center gap-1 text-sm"><input type="checkbox" name="tag_ids" value={t.id} /> {t.name}</label>)}</div>
        </fieldset>
      )}
      <Field label="Notes"><textarea className="input" name="notes" rows={3} /></Field>
      <div className="flex flex-col justify-end gap-2 sm:col-span-2">
        <Alert state={state} />
        {state?.duplicate && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {state.duplicate.visible
              ? <Link className="btn-ghost" href={`/leads/${state.duplicate.lead_id}`}>Open LB-{state.duplicate.lead_no}</Link>
              : <span className="text-slate-600">That lead belongs to another user.</span>}
            <button type="button" className="btn-navy" onClick={() => { if (forceRef.current) forceRef.current.value = "1"; formRef.current?.requestSubmit(); }}>
              Create repeat opportunity anyway
            </button>
          </div>
        )}
        <div><Submit>Create lead</Submit></div>
      </div>
    </form>
  );
}
