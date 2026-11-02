"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm, Field, Modal, Submit, type FormState } from "@/components/ui";
import { backfillCommissions, editCommission, saveAgentRate, saveCommissionSettings, setCommissionStatus } from "@/lib/actions/commissions";
import { inr } from "@/lib/quotes";

export type CRow = {
  id: string; lead_id: string; lead_no: number; customer: string; user_id: string; agent: string; deal_value: number; pct: number; flat: number;
  amount: number; status: string; manual: boolean; note: string; won_at: string | null; paid_at: string | null; paid_ref: string | null;
};

const ST: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800", approved: "bg-sky-50 text-sky-700", paid: "bg-emerald-50 text-emerald-700", cancelled: "bg-slate-100 text-slate-500",
};
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }) : "—");

function Msg({ m }: { m: FormState }) {
  if (!m?.error && !m?.ok) return null;
  return <div role={m.error ? "alert" : "status"} className={`mx-4 my-2 rounded-lg px-3 py-2 text-sm ${m.error ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{m.error ?? m.ok}</div>;
}

export function CommissionList({ rows, admin }: { rows: CRow[]; admin: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<FormState>();
  const [edit, setEdit] = useState<CRow | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ids = [...sel];
  const selTotal = rows.filter((r) => sel.has(r.id)).reduce((s, r) => s + r.amount, 0);
  const run = (status: "approved" | "paid" | "pending" | "cancelled") => {
    let ref = "";
    if (status === "paid") { const r = window.prompt("Payment reference (UTR / cheque / note), optional:"); if (r === null) return; ref = r; }
    if (status === "cancelled" && !window.confirm(`Cancel ${ids.length} commission(s)?`)) return;
    start(async () => { const r = await setCommissionStatus(ids, status, ref); setMsg(r); if (!r?.error) setSel(new Set()); router.refresh(); });
  };
  if (!rows.length) return <p className="px-4 py-6 text-sm text-slate-500">No commissions for this month yet. They appear when a lead is marked Won with a deal value.</p>;
  return (
    <>
      {admin && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50 px-4 py-2 text-sm">
          <b>{sel.size} selected · {inr(selTotal)}</b>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run("approved")}>Approve</button>
          <button className="btn-primary btn-sm" disabled={pending} onClick={() => run("paid")}>Mark paid</button>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run("pending")}>Back to pending</button>
          <button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => run("cancelled")}>Cancel</button>
          <button className="ml-auto text-xs text-slate-500 underline" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <Msg m={msg} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            {admin && <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
            <th className="th">Won</th><th className="th">Lead</th><th className="th">Agent</th><th className="th text-right">Deal value</th>
            <th className="th">Rate</th><th className="th text-right">Commission</th><th className="th">Status</th>{admin && <th className="th" />}
          </tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "bg-brand-50/50" : ""}>
                {admin && <td className="td"><input type="checkbox" aria-label={`Select LB-${r.lead_no}`} checked={sel.has(r.id)}
                  onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>}
                <td className="td whitespace-nowrap">{day(r.won_at)}</td>
                <td className="td"><Link className="text-brand-700 hover:underline" href={`/leads/${r.lead_id}`}>LB-{r.lead_no}</Link> <span className="text-slate-500">{r.customer}</span></td>
                <td className="td">{r.agent}</td>
                <td className="td text-right">{inr(r.deal_value)}</td>
                <td className="td text-xs text-slate-600">{r.manual ? "Edited" : [r.pct ? `${r.pct}%` : "", r.flat ? `+ ${inr(r.flat)}` : ""].filter(Boolean).join(" ") || "—"}</td>
                <td className="td text-right font-semibold">{inr(r.amount)}{r.note && <div className="text-[11px] font-normal text-slate-500">{r.note}</div>}</td>
                <td className="td"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${ST[r.status] ?? ""}`}>{r.status}</span>
                  {r.paid_at && <div className="text-[11px] text-slate-500">{day(r.paid_at)}{r.paid_ref ? ` · ${r.paid_ref}` : ""}</div>}</td>
                {admin && <td className="td">{r.status !== "paid" && <button className="btn-ghost btn-sm" onClick={() => setEdit(r)}>Edit</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `Commission · LB-${edit.lead_no}` : "Commission"}>
        {edit && <EditForm row={edit} onDone={() => { setEdit(null); router.refresh(); }} />}
      </Modal>
    </>
  );
}

function EditForm({ row, onDone }: { row: CRow; onDone: () => void }) {
  const [amount, setAmount] = useState(String(row.amount));
  const [note, setNote] = useState(row.note);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await editCommission(row.id, amount, note); if (r?.error) setErr(r.error); else onDone(); }); }}>
      <p className="text-sm text-slate-600">{row.agent} · deal {inr(row.deal_value)}. After you edit, this amount stays fixed even if the deal value changes.</p>
      <Field label="Commission amount (₹)"><input className="input" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      <Field label="Note (optional)"><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bonus for big order" /></Field>
      {err && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="flex justify-end"><button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button></div>
    </form>
  );
}

export function SettingsForm({ enabled, pct, flat }: { enabled: boolean; pct: number; flat: number }) {
  return (
    <ActionForm action={saveCommissionSettings}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={enabled} /> <b>Give commission on won deals</b></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Commission % of deal value"><input className="input" type="number" name="default_pct" min={0} max={100} step="0.01" defaultValue={pct} /></Field>
        <Field label="Plus flat amount per deal (₹)"><input className="input" type="number" name="flat_per_deal" min={0} step="1" defaultValue={flat} /></Field>
      </div>
      <p className="text-xs text-slate-500">Deal value = the Won value on the lead (or the invoice total when paid by link). The agent who converted the lead gets it. If a lead leaves Won before approval, its commission is cancelled.</p>
      <Submit>Save</Submit>
    </ActionForm>
  );
}

export function BackfillForm({ defaultFrom }: { defaultFrom: string }) {
  const [from, setFrom] = useState(defaultFrom);
  const [msg, setMsg] = useState<FormState>();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Commissions are made automatically for deals won from now on. To add them for deals won earlier, pick a start date.</p>
      <div className="flex flex-wrap gap-2">
        <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Won since" />
        <button className="btn-primary" disabled={pending} onClick={() => start(async () => { const r = await backfillCommissions(from); setMsg(r); router.refresh(); })}>{pending ? "Working…" : "Calculate"}</button>
      </div>
      {msg && <div role={msg.error ? "alert" : "status"} className={`rounded-lg px-3 py-2 ${msg.error ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{msg.error ?? msg.ok}</div>}
    </div>
  );
}

export function RatesTable({ rows, defaultPct, defaultFlat }: { rows: { id: string; name: string; role: string; pct: string; flat: string }[]; defaultPct: number; defaultFlat: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="th">User</th><th className="th">Commission %</th><th className="th">Flat per deal (₹)</th><th className="th" /></tr></thead>
        <tbody className="divide-y">{rows.map((r) => <RateRow key={r.id} r={r} defaultPct={defaultPct} defaultFlat={defaultFlat} />)}</tbody>
      </table>
    </div>
  );
}

function RateRow({ r, defaultPct, defaultFlat }: { r: { id: string; name: string; role: string; pct: string; flat: string }; defaultPct: number; defaultFlat: number }) {
  const [pct, setPct] = useState(r.pct);
  const [flat, setFlat] = useState(r.flat);
  const [msg, setMsg] = useState<FormState>();
  const [pending, start] = useTransition();
  const dirty = pct !== r.pct || flat !== r.flat;
  return (
    <tr>
      <td className="td">{r.name} <span className="text-xs text-slate-400">{r.role.replace("_", " ")}</span></td>
      <td className="td"><input className="input w-28" type="number" min={0} max={100} step="0.01" placeholder={`${defaultPct} (default)`} value={pct} onChange={(e) => setPct(e.target.value)} aria-label={`Commission % for ${r.name}`} /></td>
      <td className="td"><input className="input w-32" type="number" min={0} step="1" placeholder={`${defaultFlat} (default)`} value={flat} onChange={(e) => setFlat(e.target.value)} aria-label={`Flat amount for ${r.name}`} /></td>
      <td className="td">
        <button className="btn-ghost btn-sm" disabled={!dirty || pending} onClick={() => start(async () => setMsg(await saveAgentRate(r.id, pct, flat)))}>{pending ? "…" : "Save"}</button>
        {msg?.error && <span className="ml-2 text-xs text-red-600">{msg.error}</span>}{msg?.ok && !dirty && <span className="ml-2 text-xs text-emerald-700">✓</span>}
      </td>
    </tr>
  );
}
