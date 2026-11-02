"use client";
import { useState } from "react";
import Link from "next/link";
import { ActionForm, ActionButton, Field, Modal, Submit } from "@/components/ui";
import { saveLostReason, deleteLostReason } from "@/lib/actions/settings";
import { ListCard, match } from "../ui";

export type ReasonRow = { id: string; name: string; category: "lost" | "invalid" | "any"; is_active: boolean; sort_order: number; leads?: number };
const CAT: Record<string, string> = { lost: "Lost", invalid: "Invalid", any: "Lost & Invalid" };

export function ReasonList({ rows, missing }: { rows: ReasonRow[]; missing: boolean }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<ReasonRow | "new" | null>(null);
  const list = rows.filter((r) => match(q, r.name, CAT[r.category]));
  return (
    <>
      {missing && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Lost reasons are not set up in the database yet. Ask the platform owner to run the latest SQL update.</p>}
      <ListCard title="Lost Reasons" q={q} setQ={setQ}
        actions={<>
          <Link href="/win-loss" className="btn-ghost">Win / Loss report</Link>
          <button type="button" className="btn-primary" onClick={() => setEdit("new")} disabled={missing}>Add Reason +</button>
        </>}
        footer={<span className="font-normal">When a lead is marked Lost or Invalid, the team picks one of these reasons (or types a new one). The Win / Loss report groups leads by reason.</span>}>
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-slate-200">
            <tr><th className="th">Reason</th><th className="th">Used for</th><th className="th">Leads</th><th className="th">Status</th><th className="th text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {list.map((r) => (
              <tr key={r.id}>
                <td className="td font-medium text-navy-900">{r.name}</td>
                <td className="td"><span className={`badge ${r.category === "invalid" ? "bg-red-50 text-red-700" : r.category === "any" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-800"}`}>{CAT[r.category]}</span></td>
                <td className="td">{r.leads ?? 0}</td>
                <td className="td">{r.is_active ? <span className="badge bg-brand-50 text-brand-700">Active</span> : <span className="badge bg-slate-100 text-slate-500">Hidden</span>}</td>
                <td className="td text-right whitespace-nowrap">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(r)}>Edit</button>{" "}
                  <ActionButton className="btn-ghost btn-sm text-red-600" action={() => deleteLostReason(r.id)} confirm={`Delete "${r.name}"? Leads keep the reason text they already have.`}>Delete</ActionButton>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td className="td text-center text-slate-500" colSpan={5}>{rows.length ? "No match" : "No reasons yet. Add your first one."}</td></tr>}
          </tbody>
        </table>
      </ListCard>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Add lost reason" : "Edit lost reason"}>
        {edit !== null && (
          <ActionForm action={saveLostReason} onOk={() => setEdit(null)}>
            {edit !== "new" && <input type="hidden" name="id" value={edit.id} />}
            <Field label="Reason"><input className="input" name="name" required maxLength={100} defaultValue={edit === "new" ? "" : edit.name} placeholder="e.g. Price too high" autoFocus /></Field>
            <Field label="Show it when the lead is marked">
              <select className="input" name="category" defaultValue={edit === "new" ? "lost" : edit.category}>
                <option value="lost">Lost</option><option value="invalid">Invalid</option><option value="any">Lost or Invalid</option>
              </select>
            </Field>
            {edit !== "new" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={edit.is_active} /> Active (show in the picker)</label>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button><Submit>Save</Submit></div>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
