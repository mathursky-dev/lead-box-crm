"use client";
import { useState } from "react";
import { ActionForm, Submit } from "@/components/ui";
import { saveLeadCustom } from "@/lib/actions/leads";
import type { CustomField } from "@/lib/settings-shared";

const show = (f: CustomField, v: unknown) => (v === undefined || v === null || v === "" ? "—" : f.field_type === "checkbox" ? (v ? "Yes" : "No") : String(v));

/** Lead page box for Settings → Custom Fields. Read view; Edit turns it into a form. */
export function CustomFieldsPanel({ leadId, fields, values, canEdit }: { leadId: string; fields: CustomField[]; values: Record<string, unknown>; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  if (fields.length === 0) return null;
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">Custom fields</h2>
        {canEdit && !edit && <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(true)}>Edit</button>}
      </div>
      {!edit ? (
        <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
          {fields.map((f) => (
            <div key={f.key} className="contents">
              <dt className="truncate text-slate-500" title={f.label}>{f.label}</dt>
              <dd className="break-words text-navy-900">
                {f.field_type === "url" && values[f.key] ? <a className="text-brand-700 hover:underline" href={String(values[f.key])} target="_blank" rel="noreferrer">{String(values[f.key])}</a> : show(f, values[f.key])}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <ActionForm action={saveLeadCustom} onOk={() => setEdit(false)} className="space-y-2">
          <input type="hidden" name="id" value={leadId} />
          {fields.map((f) => {
            const v = values[f.key];
            const name = `cf_${f.key}`;
            return (
              <div key={f.key}>
                <input type="hidden" name="cf_keys" value={f.key} />
                <input type="hidden" name={`cf_type_${f.key}`} value={f.field_type} />
                {f.field_type === "checkbox" ? (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={Boolean(v)} /> {f.label}</label>
                ) : (
                  <label className="block">
                    <span className="label">{f.label}{f.is_required && <span className="text-red-500"> *</span>}</span>
                    {f.field_type === "textarea" ? <textarea className="input" name={name} rows={2} defaultValue={v == null ? "" : String(v)} required={f.is_required} maxLength={2000} />
                      : f.field_type === "dropdown" ? (
                        <select className="input" name={name} defaultValue={v == null ? "" : String(v)} required={f.is_required}>
                          <option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input className="input" name={name} defaultValue={v == null ? "" : String(v)} required={f.is_required} maxLength={2000}
                          type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : f.field_type === "email" ? "email" : f.field_type === "url" ? "url" : f.field_type === "phone" ? "tel" : "text"}
                          step={f.field_type === "number" ? "any" : undefined} />
                      )}
                  </label>
                )}
              </div>
            );
          })}
          <div className="flex gap-2"><Submit>Save</Submit><button type="button" className="btn-ghost" onClick={() => setEdit(false)}>Cancel</button></div>
        </ActionForm>
      )}
    </section>
  );
}
