"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/kit";
import { ActionForm, Field, Submit } from "@/components/ui";
import { assignLeads } from "@/lib/actions/leads";
import { fmtDateTime, fmtDay, money } from "@/lib/dates";

type Row = {
  id: string; lead_no: number; customer_name: string | null; phone_e164: string; status_name: string; status_category: string; sub_status_name?: string | null;
  priority: string; owner_id?: string | null; owner_name: string | null; owner_seen_at?: string | null; email?: string | null; assigned_at?: string | null; converted_at?: string | null; product_name: string | null; source_name: string | null;
  expected_value: number | null; won_value: number | null; created_at: string; last_activity_at: string; next_followup_at: string | null;
};

const CAT: Record<string, string> = {
  new: "bg-sky-50 text-sky-700", assigned: "bg-indigo-50 text-indigo-700", contacted: "bg-violet-50 text-violet-700", interested: "bg-amber-50 text-amber-700",
  follow_up: "bg-orange-50 text-orange-700", scheduled: "bg-teal-50 text-teal-700", won: "bg-brand-100 text-brand-700", lost: "bg-slate-200 text-slate-700", invalid: "bg-red-50 text-red-700",
};

// Optional columns. Lead + Customer always show; the rest the user picks
// from "Columns" and the choice is remembered in this browser per user.
const COLS = [
  { key: "status", label: "Status", on: true },
  { key: "seen", label: "Seen / Unseen", on: true },
  { key: "owner", label: "Owner", on: true },
  { key: "product", label: "Product / Source", on: true },
  { key: "value", label: "Value", on: true },
  { key: "followup", label: "Next follow-up", on: true },
  { key: "activity", label: "Last activity", on: true },
  { key: "email", label: "Email", on: false },
  { key: "created", label: "Created", on: false },
  { key: "assigned", label: "Assigned on", on: false },
  { key: "converted", label: "Converted on", on: false },
] as const;
type ColKey = (typeof COLS)[number]["key"];
const DEFAULT = COLS.filter((c) => c.on).map((c) => c.key) as ColKey[];

const unseen = (r: Row) => !!r.owner_id && !r.owner_seen_at;

export function LeadTable({ rows, canAssign, users, userId }: { rows: Row[]; canAssign: boolean; users: { id: string; name: string }[]; userId: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<ColKey[]>(DEFAULT);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const storeKey = `lb.leadCols.${userId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? "null");
      if (Array.isArray(saved)) setCols(COLS.map((c) => c.key).filter((k) => saved.includes(k)));
    } catch {}
  }, [storeKey]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const save = (next: ColKey[]) => { setCols(next); try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch {} };
  const flip = (k: ColKey) => save(cols.includes(k) ? cols.filter((c) => c !== k) : COLS.map((c) => c.key).filter((c) => c === k || cols.includes(c)));
  const show = (k: ColKey) => cols.includes(k);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const unseenCount = rows.filter(unseen).length;
  return (
    <>
      {canAssign && sel.size > 0 && (
        <div className="card mb-3 border-brand-100 bg-brand-50 p-3">
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">{unseenCount > 0 && <><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" />{unseenCount} unseen on this page</>}</div>
        <div className="relative" ref={box}>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Icon name="sliders" className="h-3.5 w-3.5" />Columns</button>
          {open && (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Show columns</div>
              {COLS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="accent-brand-600" checked={show(c.key)} onChange={() => flip(c.key)} />{c.label}
                </label>
              ))}
              <button type="button" className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-brand-700 hover:bg-slate-50" onClick={() => save(DEFAULT)}>Reset to default</button>
            </div>
          )}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {canAssign && <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
              <th className="th">Lead</th><th className="th">Customer</th>
              {show("status") && <th className="th">Status</th>}
              {show("seen") && <th className="th">Seen</th>}
              {show("owner") && <th className="th">Owner</th>}
              {show("product") && <th className="th">Product / Source</th>}
              {show("value") && <th className="th">Value</th>}
              {show("followup") && <th className="th">Next follow-up</th>}
              {show("activity") && <th className="th">Last activity</th>}
              {show("email") && <th className="th">Email</th>}
              {show("created") && <th className="th">Created</th>}
              {show("assigned") && <th className="th">Assigned on</th>}
              {show("converted") && <th className="th">Converted on</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const u = unseen(r);
              return (
              <tr key={r.id} className={u ? "bg-sky-50/40 hover:bg-sky-50" : "hover:bg-slate-50"}>
                {canAssign && <td className="td"><input type="checkbox" aria-label={`Select LB-${r.lead_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                <td className="td"><Link href={`/leads/${r.id}`} className={`text-brand-700 hover:underline ${u ? "font-bold" : "font-medium"}`}>LB-{r.lead_no}</Link>
                  <div className="text-xs capitalize text-slate-500">{r.priority}</div></td>
                <td className="td"><div className={`text-navy-900 ${u ? "font-bold" : "font-medium"}`}>{r.customer_name || "—"}</div><div className="text-xs text-slate-500">{r.phone_e164}</div></td>
                {show("status") && <td className="td"><span className={`badge ${CAT[r.status_category] ?? ""}`}>{r.status_name}</span>
                  {r.sub_status_name && <div className="mt-1 text-xs text-slate-500">{r.sub_status_name}</div>}</td>}
                {show("seen") && <td className="td text-xs">{!r.owner_id ? "—" : u
                  ? <span className="badge bg-sky-50 text-sky-700"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />Unseen</span>
                  : r.owner_seen_at ? <span className="text-slate-500" title={`Opened by owner ${fmtDateTime(r.owner_seen_at)}`}><Icon name="eye" className="mr-1 inline h-3.5 w-3.5" />Seen</span> : "—"}</td>}
                {show("owner") && <td className="td">{r.owner_name ?? <span className="badge bg-amber-50 text-amber-700">Unassigned</span>}</td>}
                {show("product") && <td className="td text-xs">{r.product_name ?? "—"}<div className="text-slate-500">{r.source_name ?? ""}</div></td>}
                {show("value") && <td className="td text-xs">{r.won_value != null ? <span className="text-brand-700">{money(r.won_value)} won</span> : money(r.expected_value)}</td>}
                {show("followup") && <td className={`td text-xs ${r.next_followup_at && new Date(r.next_followup_at) < new Date() ? "font-medium text-red-600" : ""}`}>{r.next_followup_at ? fmtDateTime(r.next_followup_at) : "—"}</td>}
                {show("activity") && <td className="td text-xs text-slate-500">{fmtDay(r.last_activity_at)}</td>}
                {show("email") && <td className="td text-xs">{r.email || "—"}</td>}
                {show("created") && <td className="td text-xs text-slate-500">{fmtDateTime(r.created_at)}</td>}
                {show("assigned") && <td className="td text-xs text-slate-500">{r.assigned_at ? fmtDateTime(r.assigned_at) : "—"}</td>}
                {show("converted") && <td className="td text-xs text-slate-500">{r.converted_at ? fmtDateTime(r.converted_at) : "—"}</td>}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
