"use client";
import { useState } from "react";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { saveStatusMaster, deleteStatusMaster } from "@/lib/actions/settings";
import { CATEGORY_LABEL } from "@/lib/labels";
import { ListCard, RefreshButton, ColorChip, ColorInput, useOrder, DragCell, IconAction, useAct, match } from "../ui";

export type StatusRow = { id: string; name: string; category: string; sort_order: number; is_active: boolean; is_default: boolean; color: string | null; leads?: number | null };

export function StatusList({ rows }: { rows: StatusRow[] }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<StatusRow | "new" | null>(null);
  const o = useOrder(rows, "statuses");
  const act = useAct();
  const searching = q.trim() !== "";
  const list = o.sorted.filter((s) => match(q, s.name, CATEGORY_LABEL[s.category]));
  return (
    <>
      <ListCard title="Status List" q={q} setQ={setQ} footer={`Total ${rows.length} Records.${o.saving ? " Saving order…" : ""}`}
        actions={<><button type="button" className="btn-primary" onClick={() => setEdit("new")}>+ Add</button><RefreshButton /></>}>
        {act.banner}{o.err && <div className="bg-red-50 px-4 py-2 text-sm text-red-700">{o.err}</div>}
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200">
            <tr><th className="th w-16"></th><th className="th">Sequence</th><th className="th">Status Name</th><th className="th">Type</th><th className="th">Color</th><th className="th">Leads</th><th className="th">Active</th><th className="th text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {list.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={8}>No statuses match.</td></tr>}
            {list.map((s) => {
              const i = o.index(s.id);
              const { className: dragCls = "", ...drag } = o.rowProps(s.id, !searching);
              return (
                <tr key={s.id} {...drag} className={`${dragCls} ${s.is_active ? "" : "text-slate-400"}`}>
                  {searching ? <td className="td" /> : <DragCell i={i} n={rows.length} onMove={(to) => o.move(s.id, to)} />}
                  <td className="td">{i + 1}</td>
                  <td className="td font-medium uppercase text-navy-900">{s.name}{s.is_default && <span className="ml-2 text-[10px] font-normal normal-case text-slate-500">default</span>}</td>
                  <td className="td text-sm">lead <span className="badge ml-1 bg-slate-100 text-slate-700">{CATEGORY_LABEL[s.category] ?? s.category}</span></td>
                  <td className="td"><ColorChip color={s.color} /></td>
                  <td className="td text-sm">{s.leads ?? "—"}</td>
                  <td className="td text-sm">{s.is_active ? "Yes" : "No"}</td>
                  <td className="td"><span className="flex justify-end gap-1.5">
                    <IconAction icon="pencil" label={`Edit ${s.name}`} onClick={() => setEdit(s)} />
                    {!s.is_default && <IconAction icon="trash" tone="red" label={`Delete ${s.name}`} onClick={() => act.run(() => deleteStatusMaster(s.id), `Delete status "${s.name}"?`)} />}
                  </span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ListCard>
      <p className="mt-2 text-xs text-slate-500">Drag the ⠿ handle to change the sequence. Sequence decides the order in dropdowns, the leads list and status cards. Type is the reporting group, so dashboards keep working when you rename a status.</p>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" ? `Edit ${edit.name}` : "Add status"}>
        {edit !== null && <StatusForm s={edit === "new" ? undefined : edit} onDone={() => setEdit(null)} />}
      </Modal>
    </>
  );
}

function StatusForm({ s, onDone }: { s?: StatusRow; onDone: () => void }) {
  return (
    <ActionForm action={saveStatusMaster} onOk={onDone}>
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Status name"><input className="input" name="name" defaultValue={s?.name} required maxLength={60} /></Field>
      <Field label="Type (reporting group)" hint="Dashboards count by this group, not by name.">
        <select className="input" name="category" defaultValue={s?.category ?? "contacted"}>
          {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Color"><ColorInput defaultValue={s?.color} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={s?.is_active ?? true} /> Active (shown in dropdowns)</label>
      <Submit>Save</Submit>
    </ActionForm>
  );
}
