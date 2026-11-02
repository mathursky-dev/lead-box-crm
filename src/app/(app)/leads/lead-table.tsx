"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/kit";
import { CustomizeTable, mergeLayout } from "@/components/customize-table";
import { deleteLeads, restoreLeads } from "@/lib/actions/leads";
import { BulkBar } from "./bulk-bar";
import { saveLeadTableLayout, type LeadTableLayout } from "@/lib/actions/prefs";
import { fmtDateTime, fmtDay, money } from "@/lib/dates";
import { PhoneMenu } from "./phone-menu";
import { AiScoreBadge } from "@/components/ai-score";
import { InlineEditProvider, StatusEdit, SubStatusEdit, ProductEdit, FollowupEdit, RemarkEdit, type EditRefs } from "./inline-edit";

type Row = {
  id: string; lead_no: number; customer_name: string | null; phone_e164: string; status_id?: string; status_name: string; status_category: string; sub_status_id?: string | null; sub_status_name?: string | null;
  priority: string; owner_id?: string | null; owner_name: string | null; owner_seen_at?: string | null; email?: string | null; assigned_at?: string | null;
  converted_at?: string | null; remark?: string | null; remark_at?: string | null; product_name: string | null; source_name: string | null;
  expected_value: number | null; won_value: number | null; created_at: string; last_activity_at: string; next_followup_at: string | null; deleted_at?: string | null;
  ai_score?: string | null; ai_score_points?: number | null; ai_score_reason?: string | null;
};


const unseen = (r: Row) => !!r.owner_id && !r.owner_seen_at;
const dash = <span className="text-slate-400">—</span>;

// Column master. "Lead" is always the first column (it opens the lead); every
// other column can be shown/hidden and moved in "Customize Table". The key is
// also the server sort key (lb_list_leads p.sort).
type Col = { key: string; label: string; on: boolean; cell: (r: Row, o: { subInStatus: boolean }) => React.ReactNode; td?: string };
const COLS: Col[] = [
  { key: "customer", label: "Customer", on: true, cell: (r) => <><div className={`text-navy-900 ${unseen(r) ? "font-bold" : "font-medium"}`}>{r.customer_name || "—"}</div><div className="flex items-center text-xs text-slate-500">{r.phone_e164}<PhoneMenu leadId={r.id} phone={r.phone_e164} /></div></> },
  { key: "mobile", label: "Mobile number", on: false, td: "text-xs", cell: (r) => <span className="flex items-center whitespace-nowrap">{r.phone_e164}<PhoneMenu leadId={r.id} phone={r.phone_e164} /></span> },
  { key: "email", label: "Email", on: false, td: "text-xs", cell: (r) => r.email || dash },
  { key: "status", label: "Status", on: true, cell: (r, o) => <StatusEdit r={r} subBelow={o.subInStatus} /> },
  { key: "ai_score", label: "AI score", on: true, cell: (r) => r.ai_score ? <AiScoreBadge score={r.ai_score} points={r.ai_score_points} reason={r.ai_score_reason} /> : dash },
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

const merge = (saved: LeadTableLayout | null): Item[] => mergeLayout(saved, DEFAULT);
const LABELS = new Map(COLS.map((c) => [c.key, c.label]));

const DEFAULT_DIR: Record<string, "asc" | "desc"> = { customer: "asc", mobile: "asc", email: "asc", status: "asc", sub_status: "asc", remark: "asc", owner: "asc", product: "asc", source: "asc", followup: "asc" };

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg viewBox="0 0 12 16" className="ml-1 inline h-3.5 w-2.5 shrink-0" aria-hidden>
      <path d="M6 1 10 6H2z" className={dir === "asc" ? "fill-brand-600" : "fill-slate-300"} />
      <path d="M6 15 2 10h8z" className={dir === "desc" ? "fill-brand-600" : "fill-slate-300"} />
    </svg>
  );
}

export function LeadTable({ rows, canAssign, canDelete = false, canBroadcast = false, deletedView = false, users, tags = [], saved, sortable, edit }: {
  rows: Row[]; canAssign: boolean; canDelete?: boolean; canBroadcast?: boolean; deletedView?: boolean; users: { id: string; name: string }[]; tags?: { id: string; name: string }[];
  saved: LeadTableLayout | null; sortable: boolean; edit: EditRefs;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [layout, setLayout] = useState<Item[]>(() => merge(saved));
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const canSelect = deletedView ? canDelete : canAssign || canDelete || canBroadcast || edit.canStatus || edit.canEdit;

  // The page toolbar's "Customize Table" button opens the modal owned here.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("leads:customize", show);
    return () => window.removeEventListener("leads:customize", show);
  }, []);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), note.bad ? 8000 : 4000); return () => clearTimeout(t); }, [note]);

  const bulk = async (kind: "delete" | "restore") => {
    const ids = [...sel];
    if (kind === "delete" && !window.confirm(`Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}? They move to Deleted and can be restored by an admin.`)) return;
    setBusy(true);
    const res = await (kind === "delete" ? deleteLeads(ids) : restoreLeads(ids));
    setBusy(false);
    if (res.error) { setNote({ text: res.error, bad: true }); return; }
    setNote({ text: `${res.n ?? 0} lead${res.n === 1 ? "" : "s"} ${kind === "delete" ? "deleted" : "restored"}` });
    setSel(new Set());
    router.refresh();
  };

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
      {canSelect && sel.size > 0 && (deletedView ? (
        <div className="card mb-3 flex flex-wrap items-center gap-3 border-brand-100 bg-brand-50 p-3">
          <div className="text-sm font-medium text-navy-900">{sel.size} selected</div>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => bulk("restore")}><Icon name="refresh" className="h-3.5 w-3.5" />{busy ? "Restoring…" : "Restore"}</button>
          <button type="button" className="btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      ) : (
        <BulkBar ids={[...sel]} users={users} statuses={edit.statuses} subStatuses={edit.subStatuses} tags={tags} busy={busy}
          perms={{ assign: canAssign, status: edit.canStatus, edit: edit.canEdit, del: canDelete, broadcast: canBroadcast, requireNext: edit.requireNext }}
          onClear={() => setSel(new Set())} onDelete={() => bulk("delete")} onNote={(text, bad) => setNote({ text, bad })} />
      ))}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">
          {unseenCount > 0 && <><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" />{unseenCount} unseen on this page</>}
          {pending && <span className="ml-2 text-slate-400">Sorting…</span>}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {canSelect && <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
              {th("lead", "Lead")}
              {visible.map((c) => th(c.key, c.label))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const u = unseen(r);
              return (
                <tr key={r.id} className={u ? "bg-sky-50/40 hover:bg-sky-50" : "hover:bg-slate-50"}>
                  {canSelect && <td className="td"><input type="checkbox" aria-label={`Select LB-${r.lead_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                  <td className="td">{deletedView ? (
                    <><span className="whitespace-nowrap font-medium text-slate-500 line-through">LB-{r.lead_no}</span>
                      <div className="whitespace-nowrap text-xs text-red-600">Deleted {r.deleted_at ? fmtDay(r.deleted_at) : ""}</div></>
                  ) : (
                    <><Link href={`/leads/${r.id}`} className={`whitespace-nowrap text-brand-700 hover:underline ${u ? "font-bold" : "font-medium"}`}>LB-{r.lead_no}</Link>
                      <div className="text-xs capitalize text-slate-500">{r.priority}</div></>
                  )}</td>
                  {visible.map((c) => <td key={c.key} className={`td ${c.td ?? ""}`}>{c.cell(r, { subInStatus })}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && <div role="status" className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${note.bad ? "bg-red-700" : "bg-navy-900"}`}>{note.text}</div>}
      {open && <CustomizeTable labels={LABELS} defaults={DEFAULT} first="Lead" save={saveLeadTableLayout} initial={layout} onClose={() => setOpen(false)} onSaved={(l) => { setLayout(l); setOpen(false); }} />}
    </InlineEditProvider>
  );
}
