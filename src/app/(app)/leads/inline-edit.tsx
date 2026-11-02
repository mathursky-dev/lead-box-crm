"use client";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { Field, Modal } from "@/components/ui";
import { quickEditLead, type QuickEdit } from "@/lib/actions/leads";
import { fmtDateTime, toLocalInput } from "@/lib/dates";
import type { StatusOpt, SubStatusOpt } from "@/lib/data";

// Inline editors for the leads list: Status, Sub-status, Product, Next follow-up
// and Remark can be changed without opening the lead. Every save goes through
// the same RPCs as the lead page (permissions, history and automations apply).

export type EditRefs = {
  statuses: StatusOpt[]; subStatuses: SubStatusOpt[]; products: { id: string; name: string; is_active?: boolean }[];
  canStatus: boolean; canEdit: boolean; requireNext: boolean;
};
type Ctx = EditRefs & { save: (id: string, e: QuickEdit) => Promise<boolean> };
const EditCtx = createContext<Ctx | null>(null);

export type EditRow = {
  id: string; lead_no: number; status_id?: string; status_name: string; status_category: string; sub_status_id?: string | null; sub_status_name?: string | null;
  product_name: string | null; next_followup_at: string | null; remark?: string | null; remark_at?: string | null;
};

const CAT: Record<string, string> = {
  new: "bg-sky-50 text-sky-700", assigned: "bg-indigo-50 text-indigo-700", contacted: "bg-violet-50 text-violet-700", interested: "bg-amber-50 text-amber-700",
  follow_up: "bg-orange-50 text-orange-700", scheduled: "bg-teal-50 text-teal-700", won: "bg-brand-100 text-brand-700", lost: "bg-slate-200 text-slate-700", invalid: "bg-red-50 text-red-700",
};
const closedCat = (c?: string) => c === "won" || c === "lost" || c === "invalid";
const dash = <span className="text-slate-400">—</span>;
const pill = "[field-sizing:content] max-w-[220px] cursor-pointer appearance-none rounded-full border border-transparent py-0.5 pl-2.5 pr-6 text-xs font-medium hover:border-slate-300 focus:border-brand-400 focus:outline-none disabled:cursor-default disabled:hover:border-transparent bg-[length:10px] bg-[right_0.45rem_center] bg-no-repeat";
const caret = { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2364748b' stroke-width='1.5'/%3E%3C/svg%3E\")" };

export function InlineEditProvider({ refs, children }: { refs: EditRefs; children: React.ReactNode }) {
  const router = useRouter();
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const [, start] = useTransition();
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.bad ? 6000 : 2500); return () => clearTimeout(t); }, [toast]);
  const save = async (id: string, e: QuickEdit) => {
    const r = await quickEditLead(id, e);
    if (r.error) { setToast({ text: r.error, bad: true }); return false; }
    setToast({ text: "Saved", bad: false });
    start(() => router.refresh());
    return true;
  };
  return (
    <EditCtx.Provider value={{ ...refs, save }}>
      {children}
      {toast && (
        <div role="status" className={`fixed bottom-4 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg ${toast.bad ? "bg-red-600 text-white" : "bg-navy-900 text-white"}`}>{toast.text}</div>
      )}
    </EditCtx.Provider>
  );
}
const useEdit = () => useContext(EditCtx);

// ------------------------------------------------------------------ status
export function StatusEdit({ r, subBelow }: { r: EditRow; subBelow: boolean }) {
  const c = useEdit();
  const [val, setVal] = useState(r.status_id ?? "");
  const [ask, setAsk] = useState<StatusOpt | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setVal(r.status_id ?? ""), [r.status_id]);
  const cur = c?.statuses.find((s) => s.id === val);
  const cat = cur?.category ?? r.status_category;
  const sub = subBelow && r.sub_status_name ? <div className="mt-1 text-xs text-slate-500">{r.sub_status_name}</div> : null;
  if (!c || !c.canStatus || !r.status_id) return <><span className={`badge ${CAT[r.status_category] ?? ""}`}>{r.status_name}</span>{sub}</>;

  const commit = async (s: StatusOpt, extra: Partial<Extract<QuickEdit, { kind: "status" }>> = {}) => {
    setBusy(true); setVal(s.id);
    const ok = await c.save(r.id, { kind: "status", status_id: s.id, ...extra });
    if (!ok) setVal(r.status_id ?? "");
    setBusy(false);
    return ok;
  };
  const pick = (id: string) => {
    const s = c.statuses.find((x) => x.id === id);
    if (!s || id === val) return;
    const needsMore = closedCat(s.category) || (c.requireNext && !r.next_followup_at);
    if (needsMore) setAsk(s); else void commit(s);
  };
  const options = c.statuses.filter((s) => s.is_active || s.id === r.status_id);
  return (
    <>
      <select aria-label={`Status of LB-${r.lead_no}`} className={`${pill} ${CAT[cat] ?? "bg-slate-100 text-slate-700"} ${busy ? "opacity-60" : ""}`} style={caret}
        value={val} disabled={busy} onChange={(e) => pick(e.target.value)}>
        {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {sub}
      {ask && <StatusDialog lead={r} status={ask} requireNext={c.requireNext} onClose={() => setAsk(null)}
        onSave={async (extra) => { if (await commit(ask, extra)) setAsk(null); }} />}
    </>
  );
}

function StatusDialog({ lead, status, requireNext, onClose, onSave }: {
  lead: EditRow; status: StatusOpt; requireNext: boolean; onClose: () => void;
  onSave: (extra: { reason?: string; won_value?: string; due?: string }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [won, setWon] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const cat = status.category;
  const lostLike = cat === "lost" || cat === "invalid";
  const needDue = !closedCat(cat) && requireNext && !lead.next_followup_at;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    await onSave({ reason: reason || undefined, won_value: won || undefined, due: due || undefined });
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={`LB-${lead.lead_no} → ${status.name}`}>
      <form onSubmit={submit} className="space-y-3">
        {cat === "won" && <Field label="Won value (₹)"><input className="input" type="number" min={0} step="0.01" value={won} onChange={(e) => setWon(e.target.value)} autoFocus /></Field>}
        {lostLike && <Field label="Reason (required)"><input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Wrong number" /></Field>}
        {needDue && <Field label="Next follow-up (required)" hint="Open leads need a next action."><input className="input" type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} autoFocus /></Field>}
        {!lostLike && <Field label="Comment (optional)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shows in the Remark column" /></Field>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ sub-status
export function SubStatusEdit({ r }: { r: EditRow }) {
  const c = useEdit();
  const [val, setVal] = useState(r.sub_status_id ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setVal(r.sub_status_id ?? ""), [r.sub_status_id]);
  const subs = (c?.subStatuses ?? []).filter((x) => (x.status_id == null || x.status_id === r.status_id) && (x.is_active || x.id === r.sub_status_id));
  if (!c || !c.canStatus || !r.status_id || subs.length === 0) {
    return r.sub_status_name ? <span className="badge whitespace-nowrap bg-slate-100 text-slate-700">{r.sub_status_name}</span> : dash;
  }
  const pick = async (id: string) => {
    setBusy(true); setVal(id);
    if (!(await c.save(r.id, { kind: "sub_status", sub_status_id: id || null }))) setVal(r.sub_status_id ?? "");
    setBusy(false);
  };
  return (
    <select aria-label={`Sub-status of LB-${r.lead_no}`} className={`${pill} whitespace-nowrap ${val ? "bg-slate-100 text-slate-700" : "bg-transparent text-slate-400"} ${busy ? "opacity-60" : ""}`} style={caret}
      value={val} disabled={busy} onChange={(e) => pick(e.target.value)}>
      <option value="">—</option>
      {subs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
}

// ------------------------------------------------------------------ product
export function ProductEdit({ r }: { r: EditRow }) {
  const c = useEdit();
  const current = c?.products.find((p) => p.name === r.product_name)?.id ?? "";
  const [val, setVal] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setVal(current), [current]);
  if (!c || !c.canEdit || c.products.length === 0) return r.product_name ?? dash;
  const pick = async (id: string) => {
    setBusy(true); setVal(id);
    if (!(await c.save(r.id, { kind: "product", product_id: id || null }))) setVal(current);
    setBusy(false);
  };
  return (
    <select aria-label={`Product of LB-${r.lead_no}`} className={`${pill} max-w-[160px] ${val ? "bg-slate-50 text-navy-900" : "bg-transparent text-slate-400"} ${busy ? "opacity-60" : ""}`} style={caret}
      value={val} disabled={busy} onChange={(e) => pick(e.target.value)}>
      <option value="">—</option>
      {c.products.filter((p) => p.is_active !== false || p.id === current).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

// ------------------------------------------------------------------ next follow-up
export function FollowupEdit({ r }: { r: EditRow }) {
  const c = useEdit();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const overdue = r.next_followup_at && new Date(r.next_followup_at) < new Date();
  const shown = r.next_followup_at ? <span className={overdue ? "font-medium text-red-600" : ""}>{fmtDateTime(r.next_followup_at)}</span> : dash;
  if (!c) return shown;
  if (!editing) {
    return (
      <button type="button" className="group inline-flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-slate-100" title="Change next follow-up"
        onClick={() => { setVal(toLocalInput(r.next_followup_at) || ""); setEditing(true); }}>
        {r.next_followup_at ? shown : <span className="text-slate-400 group-hover:text-brand-700">+ Set</span>}
        <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-300 group-hover:text-slate-500" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>
      </button>
    );
  }
  const commit = async () => {
    if (!val) { setEditing(false); return; }
    setBusy(true);
    if (await c.save(r.id, { kind: "followup", due: val })) setEditing(false);
    setBusy(false);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input type="datetime-local" className="input h-7 w-[11.5rem] px-1.5 py-0 text-xs" value={val} autoFocus disabled={busy}
        onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setEditing(false); }} />
      <button type="button" className="rounded bg-brand-600 px-1.5 py-1 text-[11px] font-medium text-white disabled:opacity-60" disabled={busy || !val} onClick={commit}>Save</button>
      <button type="button" className="px-1 text-slate-400 hover:text-slate-700" onClick={() => setEditing(false)} aria-label="Cancel">✕</button>
    </span>
  );
}

// ------------------------------------------------------------------ remark
export function RemarkEdit({ r }: { r: EditRow }) {
  const c = useEdit();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = r.remark
    ? <div className="line-clamp-2 max-w-[240px] whitespace-normal break-words text-slate-700" title={`${r.remark}${r.remark_at ? `\n— ${fmtDateTime(r.remark_at)}` : ""}`}>{r.remark}</div>
    : dash;
  if (!c) return text;
  if (!editing) {
    return (
      <button type="button" className="group block w-full min-w-[120px] rounded px-1 py-0.5 text-left hover:bg-slate-100" title="Add a remark"
        onClick={() => { setVal(""); setEditing(true); }}>
        {r.remark ? text : <span className="text-slate-400 group-hover:text-brand-700">+ Add remark</span>}
      </button>
    );
  }
  const commit = async () => {
    const t = val.trim();
    if (!t) { setEditing(false); return; }
    setBusy(true);
    if (await c.save(r.id, { kind: "remark", text: t })) setEditing(false);
    setBusy(false);
  };
  return (
    <div className="w-[240px]">
      <textarea ref={ref} rows={2} className="input w-full px-2 py-1 text-xs" placeholder={r.remark ? `Now: ${r.remark}` : "e.g. n/p, call back tomorrow"} value={val} autoFocus disabled={busy} maxLength={2000}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void commit(); } if (e.key === "Escape") setEditing(false); }} />
      <div className="mt-1 flex items-center gap-2">
        <button type="button" className="rounded bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-60" disabled={busy || !val.trim()} onClick={commit}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="text-[11px] text-slate-500 hover:text-slate-800" onClick={() => setEditing(false)}>Cancel</button>
        <span className="ml-auto text-[10px] text-slate-400">Saved as a note</span>
      </div>
    </div>
  );
}
