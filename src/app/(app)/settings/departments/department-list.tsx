"use client";
import { useState } from "react";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { saveDepartment, deleteDepartment } from "@/lib/actions/settings";
import { ListCard, RefreshButton, IconAction, useAct, match } from "../ui";

type Row = { id: string; name: string; is_active?: boolean; branch_id: string | null; branch: string | null; leads: number };
type Sort = "name" | "branch" | "leads";

export function DepartmentList({ rows, branches }: { rows: Row[]; branches: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: Sort; asc: boolean }>({ k: "name", asc: true });
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const act = useAct();
  const list = rows.filter((d) => match(q, d.name, d.branch)).sort((a, b) => {
    const v = sort.k === "leads" ? a.leads - b.leads : (a[sort.k] ?? "").localeCompare(b[sort.k] ?? "");
    return sort.asc ? v : -v;
  });
  const th = (k: Sort, label: string) => (
    <th className="th"><button type="button" className="inline-flex items-center gap-1" onClick={() => setSort((s) => ({ k, asc: s.k === k ? !s.asc : true }))}>
      {label}<span className="text-slate-400">{sort.k === k ? (sort.asc ? "↑" : "↓") : "⇅"}</span></button></th>
  );
  return (
    <>
      <ListCard title="Departments" q={q} setQ={setQ} footer={`Total ${rows.length} Records.`}
        actions={<><button type="button" className="btn-primary" onClick={() => setEdit("new")}>+ Add</button><RefreshButton /></>}>
        {act.banner}
        <table className="w-full min-w-[600px]">
          <thead className="border-b border-slate-200"><tr>{th("name", "Department Name")}{th("branch", "Branch")}{th("leads", "Leads")}<th className="th">Active</th><th className="th text-right">Actions</th></tr></thead>
          <tbody className="divide-y">
            {list.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={5}>{rows.length ? "No departments match." : "No departments yet."}</td></tr>}
            {list.map((d) => (
              <tr key={d.id} className={d.is_active === false ? "text-slate-400" : ""}>
                <td className="td font-medium text-navy-900">{d.name}</td>
                <td className="td text-sm">{d.branch ?? "—"}</td>
                <td className="td text-sm">{d.leads}</td>
                <td className="td text-sm">{d.is_active === false ? "No" : "Yes"}</td>
                <td className="td"><span className="flex justify-end gap-1.5">
                  <IconAction icon="pencil" label={`Edit ${d.name}`} onClick={() => setEdit(d)} />
                  <IconAction icon="trash" tone="red" label={`Delete ${d.name}`} onClick={() => act.run(() => deleteDepartment(d.id), `Delete department "${d.name}"?`)} />
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      <p className="mt-2 text-xs text-slate-500">Departments are used on leads, users, teams and WhatsApp numbers (Company → Branch → Department → Team). Teams and branches stay on the Organisation page.</p>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" ? `Edit ${edit.name}` : "Add department"}>
        {edit !== null && (
          <ActionForm action={saveDepartment} onOk={() => setEdit(null)}>
            {edit !== "new" && <input type="hidden" name="id" value={edit.id} />}
            <Field label="Department name"><input className="input" name="name" defaultValue={edit === "new" ? "" : edit.name} required maxLength={100} placeholder="e.g. Wholesale Home Decor" /></Field>
            <Field label="Branch (optional)">
              <select className="input" name="branch_id" defaultValue={edit === "new" ? "" : edit.branch_id ?? ""}>
                <option value="">No branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={edit === "new" ? true : edit.is_active !== false} /> Active</label>
            <Submit>Save</Submit>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
