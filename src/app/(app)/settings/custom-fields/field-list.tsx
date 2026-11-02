"use client";
import { useState } from "react";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { saveCustomField, deleteCustomField } from "@/lib/actions/settings";
import { FIELD_TYPES, FIELD_TYPE_LABEL, type CustomField } from "@/lib/settings-shared";
import { ListCard, RefreshButton, useOrder, DragCell, IconAction, useAct, match } from "../ui";

export function FieldList({ rows }: { rows: CustomField[] }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<CustomField | "new" | null>(null);
  const o = useOrder(rows, "fields");
  const act = useAct();
  const searching = q.trim() !== "";
  const list = o.sorted.filter((f) => match(q, f.label, f.key, FIELD_TYPE_LABEL[f.field_type]));
  return (
    <>
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
        <span className="rounded-md bg-white px-3 py-1 font-semibold text-brand-700 shadow-sm">Lead</span>
      </div>
      <ListCard title="Custom Fields" q={q} setQ={setQ} footer={`Total ${rows.length} Records.${o.saving ? " Saving order…" : ""}`}
        actions={<><button type="button" className="btn-primary" onClick={() => setEdit("new")}>+ Add Field</button><RefreshButton /></>}>
        {act.banner}{o.err && <div className="bg-red-50 px-4 py-2 text-sm text-red-700">{o.err}</div>}
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200">
            <tr><th className="th w-16"></th><th className="th">Field Name</th><th className="th">Type</th><th className="th">Choices</th><th className="th">Required</th><th className="th">Active</th><th className="th text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {list.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={7}>{rows.length ? "No fields match." : "No custom fields yet. Add fields like Budget, Property type, GST number or Requirement. They show on every lead and can be put on Forms."}</td></tr>}
            {list.map((f) => {
              const i = o.index(f.id);
              const { className: dragCls = "", ...drag } = o.rowProps(f.id, !searching);
              return (
                <tr key={f.id} {...drag} className={`${dragCls} ${f.is_active ? "" : "text-slate-400"}`}>
                  {searching ? <td className="td" /> : <DragCell i={i} n={rows.length} onMove={(to) => o.move(f.id, to)} />}
                  <td className="td"><div className="font-medium text-navy-900">{f.label}</div><div className="font-mono text-[11px] text-slate-400">{f.key}</div></td>
                  <td className="td text-sm">{FIELD_TYPE_LABEL[f.field_type] ?? f.field_type}</td>
                  <td className="td max-w-xs truncate text-sm text-slate-600" title={f.options.join(", ")}>{f.options.length ? f.options.join(", ") : "—"}</td>
                  <td className="td text-sm">{f.is_required ? "Yes" : "No"}</td>
                  <td className="td text-sm">{f.is_active ? "Yes" : "No"}</td>
                  <td className="td"><span className="flex justify-end gap-1.5">
                    <IconAction icon="pencil" label={`Edit ${f.label}`} onClick={() => setEdit(f)} />
                    <IconAction icon="trash" tone="red" label={`Delete ${f.label}`} onClick={() => act.run(() => deleteCustomField(f.id), `Delete field "${f.label}"? Values already saved on leads are hidden (not shown anywhere).`)} />
                  </span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ListCard>
      <p className="mt-2 text-xs text-slate-500">Custom fields appear in the “Custom fields” box on every lead page, in the order above. Switch a field off to hide it without losing saved values.</p>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" ? `Edit ${edit.label}` : "Add custom field"}>
        {edit !== null && <FieldForm f={edit === "new" ? undefined : edit} onDone={() => setEdit(null)} />}
      </Modal>
    </>
  );
}

function FieldForm({ f, onDone }: { f?: CustomField; onDone: () => void }) {
  const [type, setType] = useState<string>(f?.field_type ?? "text");
  return (
    <ActionForm action={saveCustomField} onOk={onDone}>
      {f && <input type="hidden" name="id" value={f.id} />}
      <Field label="Field name"><input className="input" name="label" defaultValue={f?.label} required maxLength={80} placeholder="e.g. Budget" /></Field>
      <Field label="Field type">
        <select className="input" name="field_type" value={type} onChange={(e) => setType(e.target.value)}>
          {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {type === "dropdown" && (
        <Field label="Choices" hint="One per line (or comma separated).">
          <textarea className="input" name="options" rows={4} defaultValue={f?.options.join("\n")} required />
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_required" defaultChecked={f?.is_required ?? false} /> Required when editing a lead</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={f?.is_active ?? true} /> Active</label>
      <Submit>Save</Submit>
    </ActionForm>
  );
}
