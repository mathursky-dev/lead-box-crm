"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/kit";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { assignLeads } from "@/lib/actions/leads";
import { saveLeadTableLayout, type LeadTableLayout } from "@/lib/actions/prefs";
import { fmtDateTime, fmtDay, money } from "@/lib/dates";
import { InlineEditProvider, StatusEdit, SubStatusEdit, ProductEdit, FollowupEdit, RemarkEdit, type EditRefs } from "./inline-edit";

type Row = {
  id: string; lead_no: number; customer_name: string | null; phone_e164: string; status_id?: string; status_name: string; status_category: string; sub_status_id?: string | null; sub_status_name?: string | null;
  priority: string; owner_id?: string | null; owner_name: string | null; owner_seen_at?: string | null; email?: string | null; assigned_at?: string | null;
  converted_at?: string | null; remark?: string | null; remark_at?: string | null; product_name: string | null; source_name: string | null;
  expected_value: number | null; won_value: number | null; created_at: string; last_activity_at: string; next_followup_at: string | null;
};


const unseen = (r: Row) => !!r.owner_id && !r.owner_seen_at;
const dash = <span className="text-slate-400">—</span>;

// Column master. "Lead" is always the first column (it opens the lead); every
// other column can be shown/hidden and moved in "Customize Table". The key is
// also the server sort key (lb_list_leads p.sort).
type Col = { key: string; label: string; on: boolean; cell: (r: Row, o: { subInStatus: boolean }) => React.ReactNode; td?: string };
const COLS: Col[] = [
  { key: "customer", label: "Customer", on: true, cell: (r) => <><div className={`text-navy-900 ${unseen(r) ? "font-bold" : "font-medium"}`}>{r.customer_name || "—"}</div><div className="text-xs text-slate-500">{r.phone_e164}</div></> },
  { key: "mobile", label: "Mobile number", on: false, td: "text-xs", cell: (r) => r.phone_e164 },
  { key: "email", label: "Email", on: false, td: "text-xs", cell: (r) => r.email || dash },
  { key: "status", label: "Status", on: true, cell: (r, o) => <StatusEdit r={r} subBelow={o.subInStatus} /> },
  { key: "sub_status", label: "Sub-status", on: true, td: "text-xs", cell: (r) => <SubStatusEdit r={r} /> },
  { key: "remark", label: "Remark", on: true, td: "text-xs", cell: (r) => <RemarkEdit r={r} /> },
  { key: "seen", label: "Seen / Unseen", on: true, td: "text-xs", cell: (r) => !r.owner_id ? dash : unseen(r)
      ? <span className="badge bg-sky-50 text-sky-700"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />Unseen</span>
      : <span className="text-slate-500" title={r.owner_seen_at ? `Opened by owner ${fmtDateTime(r.owner_seen_at)}` : ""}><Icon name="eye" className="mr-1 inline h-3.5 w-3.5" />Seen</span> },
  { key: "owner", label: "Owner", on: true, cell: (r) => r.owner_name ?? <span className="badge bg-amber-50 text-amber-700">Unassigned</span> },
  { key: "priority", label: "Priority", on: false, td: "text-xs capitalize", cell: (r) => r.priority },
  { key: "product", label: "Product", on: true, td: "text-xs", cell: (r) => <ProductEdit r={r} /> },
  { key: "source", label: "Source", on: true, td: "text-xs", cell: (r) => r.source_name ?? dash },
  { key: "value", label: "Value", on: true, td: "text-xs", cell: (r) => r.won_value != null ? <span className="text-brand-700">{money(r.won_value)} won</span> : money(r.expected_value) },
  { key: "followup", label: "Next follow-up", on: true, td: "text-xs", cell: (r) => <FollowupEdit r={r} /> },
  { key: "activity", label: "Last activity", on: true, td: "text-xs text-slate-500", cell: (r) => fmtDay(r.last_activity_at) },
  { key: "created", label: "Created on", on: false, td: "text-xs text-slate-500", cell: (r) => fmtDateTime(r.created_at) },
  { key: "assigned", label: "Assigned on", on: false, td: "text-xs text-slate-500", cell: (r) => r.assigned_at ? fmtDateTime(r.assigned_at) : dash },
  { key: "converted", label: "Converted on", on: false, td: "text-xs text-slate-500", cell: (r) => r.converted_at ? fmtDateTime(r.converted_at) : dash },
];
const BY_KEY = new Map(COLS.map((c) => [c.key, c]));
type Item = { k: string; on: boolean };
const DEFAULT: Item[] = COLS.map((c) => ({ k: c.key, on: c.on }));

// Saved order first (unknown keys dropped), then any column added since the save.
function merge(saved: LeadTableLayout | null): Item[] {
  if (!saved?.cols?.length) return DEFAULT;
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const c of saved.cols) if (BY_KEY.has(c.k) && !seen.has(c.k)) { seen.add(c.k); out.push({ k: c.k, on: !!c.on }); }
  for (const d of DEFAULT) if (!seen.has(d.k)) out.push(d);
  return out;
}

const DEFAULT_DIR: Record<string, "asc" | "desc"> = { customer: "asc", mobile: "asc", email: "asc", status: "asc", sub_status: "asc", remark: "asc", owner: "asc", product: "asc", source: "asc", followup: "asc" };

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg viewBox="0 0 12 16" className="ml-1 inline h-3.5 w-2.5 shrink-0" aria-hidden>
      <path d="M6 1 10 6H2z" className={dir === "asc" ? "fill-brand-600" : "fill-slate-300"} />
      <path d="M6 15 2 10h8z" className={dir === "desc" ? "fill-brand-600" : "fill-slate-300"} />
    </svg>
  );
}

export function LeadTable({ rows, canAssign, users, saved, sortable, edit }: {
  rows: Row[]; canAssign: boolean; users: { id: string; name: string }[]; saved: LeadTableLayout | null; sortable: boolean; edit: EditRefs;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [layout, setLayout] = useState<Item[]>(() => merge(saved));
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const visible = layout.filter((i) => i.on).map((i) => BY_KEY.get(i.k)!);
  const subInStatus = !layout.find((i) => i.k === "sub_status")?.on;
  const sortKey = params.get("sort") || "activity";
  const sortDir = (params.get("dir") as "asc" | "desc" | null) || (sortKey === "followup" ? "asc" : "desc");

  const sortBy = (key: string) => {
    const next = new URLSearchParams(params.toString());
    const dir = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : (DEFAULT_DIR[key] ?? "desc");
    next.set("sort", key); next.set("dir", dir); next.delete("offset");
    startTransition(() => router.push(`${pathname}?${next}`));
  };

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const unseenCount = rows.filter(unseen).length;

  const th = (k: string, label: string) => (
    <th key={k} className="th whitespace-nowrap" aria-sort={sortable && sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
      {sortable ? (
        <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center uppercase hover:text-navy-900" title={`Sort by ${label}`}>
          {label}<SortIcon dir={sortKey === k ? sortDir : null} />
        </button>
      ) : label}
    </th>
  );

  return (
    <InlineEditProvider refs={edit}>
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
        <div className="text-xs text-slate-500">
          {unseenCount > 0 && <><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" />{unseenCount} unseen on this page</>}
          {pending && <span className="ml-2 text-slate-400">Sorting…</span>}
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}><Icon name="sliders" className="h-3.5 w-3.5" />Customize Table</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {canAssign && <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
              {th("lead", "Lead")}
              {visible.map((c) => th(c.key, c.label))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const u = unseen(r);
              return (
                <tr key={r.id} className={u ? "bg-sky-50/40 hover:bg-sky-50" : "hover:bg-slate-50"}>
                  {canAssign && <td className="td"><input type="checkbox" aria-label={`Select LB-${r.lead_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                  <td className="td"><Link href={`/leads/${r.id}`} className={`whitespace-nowrap text-brand-700 hover:underline ${u ? "font-bold" : "font-medium"}`}>LB-{r.lead_no}</Link>
                    <div className="text-xs capitalize text-slate-500">{r.priority}</div></td>
                  {visible.map((c) => <td key={c.key} className={`td ${c.td ?? ""}`}>{c.cell(r, { subInStatus })}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && <CustomizeTable initial={layout} onClose={() => setOpen(false)} onSaved={(l) => { setLayout(l); setOpen(false); }} />}
    </InlineEditProvider>
  );
}

function CustomizeTable({ initial, onClose, onSaved }: { initial: Item[]; onClose: () => void; onSaved: (l: Item[]) => void }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const shown = useMemo(() => items.filter((i) => BY_KEY.get(i.k)!.label.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);
  const idx = cur ? items.findIndex((i) => i.k === cur) : -1;
  const move = (to: "top" | "up" | "down" | "bottom") => {
    if (idx < 0) return;
    const next = [...items];
    const [it] = next.splice(idx, 1);
    const at = to === "top" ? 0 : to === "bottom" ? next.length : to === "up" ? Math.max(0, idx - 1) : Math.min(next.length, idx + 1);
    next.splice(at, 0, it);
    setItems(next);
  };
  const flip = (k: string) => setItems((xs) => xs.map((x) => (x.k === k ? { ...x, on: !x.on } : x)));
  const count = items.filter((i) => i.on).length;
  const save = (next: Item[], reset = false) => startSaving(async () => {
    setError(null);
    const r = await saveLeadTableLayout(reset ? null : { v: 1, cols: next });
    if (r.error) setError(r.error); else onSaved(next);
  });

  const moveBtn = (to: "top" | "up" | "down" | "bottom", label: string, d: string) => (
    <button key={to} type="button" onClick={() => move(to)} disabled={idx < 0 || ((to === "top" || to === "up") && idx === 0) || ((to === "down" || to === "bottom") && idx === items.length - 1)}
      className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Customize Table">
      <input className="input mb-3" placeholder="Search columns" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="flex gap-3">
        <div className="flex flex-col justify-center gap-2">
          {moveBtn("top", "Move to top", "M7 11l5-5 5 5M7 18l5-5 5 5")}
          {moveBtn("up", "Move up", "M6 15l6-6 6 6")}
          {moveBtn("down", "Move down", "M6 9l6 6 6-6")}
          {moveBtn("bottom", "Move to bottom", "M7 6l5 5 5-5M7 13l5 5 5-5")}
        </div>
        <div className="max-h-[52vh] flex-1 overflow-y-auto rounded-lg border border-slate-200">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            <input type="checkbox" checked disabled className="h-4 w-4" /> Lead <span className="ml-auto text-xs">always first</span>
          </div>
          {shown.map((i) => (
            <div key={i.k} onClick={() => setCur(i.k)}
              className={`flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 ${cur === i.k ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-slate-50"}`}>
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={i.on} onChange={() => flip(i.k)} onClick={(e) => e.stopPropagation()} aria-label={`Show ${BY_KEY.get(i.k)!.label}`} />
              <span className={i.on ? "text-navy-900" : "text-slate-500"}>{BY_KEY.get(i.k)!.label}</span>
            </div>
          ))}
          {shown.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">No column matches “{q}”.</div>}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Tick to show a column. Click a row, then use the arrows to move it. {count} of {items.length} columns shown. Saved to your login, so it follows you on every device.</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button type="button" className="btn-ghost" disabled={saving} onClick={() => { setItems(DEFAULT); save(DEFAULT, true); }}>Reset</button>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => save(items)}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
