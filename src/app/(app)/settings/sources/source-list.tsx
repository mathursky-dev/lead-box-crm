"use client";
import { useState } from "react";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { saveSource, deleteSource } from "@/lib/actions/settings";
import { ListCard, RefreshButton, ColorChip, ColorInput, useOrder, DragCell, IconAction, useAct, match } from "../ui";

export type SourceRow = { id: string; name: string; color: string | null; sort_order: number; is_active: boolean; is_system: boolean; leads?: number };

export function SourceList({ rows }: { rows: SourceRow[] }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<SourceRow | "new" | null>(null);
  const o = useOrder(rows, "sources");
  const act = useAct();
  const searching = q.trim() !== "";
  const list = o.sorted.filter((s) => match(q, s.name));
  return (
    <>
      <ListCard title="Source List" q={q} setQ={setQ} footer={`Total ${rows.length} Records.${o.saving ? " Saving order…" : ""}`}
        actions={<><button type="button" className="btn-primary" onClick={() => setEdit("new")}>+ Add</button><RefreshButton /></>}>
        {act.banner}{o.err && <div className="bg-red-50 px-4 py-2 text-sm text-red-700">{o.err}</div>}
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-slate-200">
            <tr><th className="th w-16"></th><th className="th">Source Name</th><th className="th">Sequence</th><th className="th">Color</th><th className="th">Leads</th><th className="th">Active</th><th className="th text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {list.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={7}>No sources match.</td></tr>}
            {list.map((s) => {
              const i = o.index(s.id);
              const { className: dragCls = "", ...drag } = o.rowProps(s.id, !searching);
              return (
                <tr key={s.id} {...drag} className={`${dragCls} ${s.is_active ? "" : "text-slate-400"}`}>
                  {searching ? <td className="td" /> : <DragCell i={i} n={rows.length} onMove={(to) => o.move(s.id, to)} />}
                  <td className="td font-medium text-navy-900">{s.name}{s.is_system && <span className="ml-2 text-[10px] font-normal text-slate-500">built-in</span>}</td>
                  <td className="td">{i + 1}</td>
                  <td className="td"><ColorChip color={s.color} /></td>
                  <td className="td text-sm">{s.leads ?? 0}</td>
                  <td className="td text-sm">{s.is_active ? "Yes" : "No"}</td>
                  <td className="td"><span className="flex justify-end gap-1.5">
                    <IconAction icon="pencil" label={`Edit ${s.name}`} onClick={() => setEdit(s)} />
                    {!s.is_system && <IconAction icon="trash" tone="red" label={`Delete ${s.name}`} onClick={() => act.run(() => deleteSource(s.id), `Delete source "${s.name}"?`)} />}
                  </span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ListCard>
      <p className="mt-2 text-xs text-slate-500">Drag the ⠿ handle to change the sequence (used in source dropdowns and filters). Built-in sources like WhatsApp, Manual, Import and Facebook are set automatically, so only their colour can change.</p>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" ? `Edit ${edit.name}` : "Add source"}>
        {edit !== null && (
          <ActionForm action={saveSource} onOk={() => setEdit(null)}>
            {edit !== "new" && <input type="hidden" name="id" value={edit.id} />}
            <Field label="Source name"><input className="input" name="name" defaultValue={edit === "new" ? "" : edit.name} required maxLength={100} readOnly={edit !== "new" && edit.is_system} placeholder="e.g. 99 Acres" /></Field>
            <Field label="Color"><ColorInput defaultValue={edit === "new" ? null : edit.color} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={edit === "new" ? true : edit.is_active} /> Active (offered for new leads)</label>
            <Submit>Save</Submit>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
