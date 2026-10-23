"use client";
import Link from "next/link";
import { useState } from "react";
import { ActionForm, Field, Submit } from "@/components/ui";
import { assignLeads } from "@/lib/actions/leads";
import { fmtDateTime, fmtDay, money } from "@/lib/dates";

type Row = {
  id: string; lead_no: number; customer_name: string | null; phone_e164: string; status_name: string; status_category: string;
  priority: string; owner_name: string | null; product_name: string | null; source_name: string | null;
  expected_value: number | null; won_value: number | null; created_at: string; last_activity_at: string; next_followup_at: string | null;
};

const CAT: Record<string, string> = {
  new: "bg-sky-50 text-sky-700", assigned: "bg-indigo-50 text-indigo-700", contacted: "bg-violet-50 text-violet-700", interested: "bg-amber-50 text-amber-700",
  follow_up: "bg-orange-50 text-orange-700", scheduled: "bg-teal-50 text-teal-700", won: "bg-brand-100 text-brand-700", lost: "bg-slate-200 text-slate-700", invalid: "bg-red-50 text-red-700",
};

export function LeadTable({ rows, canAssign, users }: { rows: Row[]; canAssign: boolean; users: { id: string; name: string }[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  return (
    <>
      {canAssign && sel.size > 0 && (
        <div className="card mb-3 border-brand-500 bg-brand-50 p-3">
          <ActionForm action={assignLeads} onOk={() => setSel(new Set())} className="flex flex-wrap items-end gap-2">
            {[...sel].map((id) => <input key={id} type="hidden" name="lead_ids" value={id} />)}
            <div className="text-sm font-medium text-navy-900">{sel.size} selected</div>
            <Field label="Assign to">
              <select className="input min-w-48" name="owner_id" required defaultValue="">
                <option value="" disabled>Choose…</option>
                <option value="__auto__">Round-robin (allocation rules)</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Reason (required when reassigning)"><input className="input min-w-64" name="reason" /></Field>
            <Submit>Assign</Submit>
            <button type="button" className="btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
          </ActionForm>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b bg-slate-50">
            <tr>
              {canAssign && <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
              <th className="th">Lead</th><th className="th">Customer</th><th className="th">Status</th><th className="th">Owner</th>
              <th className="th">Product / Source</th><th className="th">Value</th><th className="th">Next follow-up</th><th className="th">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {canAssign && <td className="td"><input type="checkbox" aria-label={`Select LB-${r.lead_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                <td className="td"><Link href={`/leads/${r.id}`} className="font-medium text-brand-700 hover:underline">LB-{r.lead_no}</Link>
                  <div className="text-xs capitalize text-slate-500">{r.priority}</div></td>
                <td className="td"><div className="font-medium text-navy-900">{r.customer_name || "—"}</div><div className="text-xs text-slate-500">{r.phone_e164}</div></td>
                <td className="td"><span className={`badge ${CAT[r.status_category] ?? ""}`}>{r.status_name}</span></td>
                <td className="td">{r.owner_name ?? <span className="text-amber-700">Unassigned</span>}</td>
                <td className="td text-xs">{r.product_name ?? "—"}<div className="text-slate-500">{r.source_name ?? ""}</div></td>
                <td className="td text-xs">{r.won_value != null ? <span className="text-brand-700">{money(r.won_value)} won</span> : money(r.expected_value)}</td>
                <td className={`td text-xs ${r.next_followup_at && new Date(r.next_followup_at) < new Date() ? "font-medium text-red-600" : ""}`}>{r.next_followup_at ? fmtDateTime(r.next_followup_at) : "—"}</td>
                <td className="td text-xs text-slate-500">{fmtDay(r.last_activity_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
