"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/kit";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { CustomizeTable, mergeLayout, type ColItem } from "@/components/customize-table";
import { saveTableLayout, type LeadTableLayout } from "@/lib/actions/prefs";
import { assignTasks, deleteTasks, saveTask, searchTaskLeads, setTaskStatus, type LeadHit } from "@/lib/actions/tasks";
import { fmtDateTime, fmtDay, toLocalInput } from "@/lib/dates";
import { TASK_PAGE_SIZES, TASK_DUE_FILTERS, TASK_PRIORITIES, TASK_SCOPES, TASK_STATUSES, OPEN_STATUSES, priorityOf, statusOf, type TaskStatus } from "@/lib/tasks";
import { PhoneMenu } from "../leads/phone-menu";


export type TaskRow = {
  id: string; task_no: number; title: string; description: string; status: string; priority: number; due_at: string | null; completed_at: string | null;
  created_at: string; updated_at: string; assigned_by: string | null; assigned_to: string | null; lead_id: string | null;
  assigner: { full_name: string } | null; assignee: { full_name: string } | null;
  lead: { id: string; lead_no: number; customer: { name: string | null; phone_e164: string } | null } | null;
};
type User = { id: string; name: string };

const dash = <span className="text-slate-400">—</span>;
const isOverdue = (r: TaskRow) => !!r.due_at && OPEN_STATUSES.includes(r.status as TaskStatus) && new Date(r.due_at) < new Date();

export function PriorityIcon({ p, className = "h-4 w-4" }: { p: number; className?: string }) {
  const c = priorityOf(p);
  const d = p === 1 ? "M6 6l6 6 6-6M6 12l6 6 6-6" : p === 2 ? "M6 9l6 6 6-6" : p === 3 ? "M5 9h14M5 15h14" : p === 4 ? "M6 15l6-6 6 6" : "M6 12l6-6 6 6M6 18l6-6 6 6";
  return <svg viewBox="0 0 24 24" className={`${className} ${c.cls}`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label={c.label}><path d={d} /></svg>;
}

// Column master for Customize Table. "Task" is always first; the key is also the sort key where sortable.
type Col = { key: string; label: string; on: boolean; sort?: boolean; td?: string; cell: (r: TaskRow, x: { setStatus: (r: TaskRow, s: string) => void }) => React.ReactNode };
const COLS: Col[] = [
  { key: "description", label: "Description", on: true, td: "max-w-[240px] text-xs text-slate-600", cell: (r) => r.description ? <span className="line-clamp-2" title={r.description}>{r.description}</span> : dash },
  { key: "assigned_by", label: "Assigned By", on: true, td: "text-sm whitespace-nowrap", cell: (r) => r.assigner?.full_name ?? dash },
  { key: "assigned_to", label: "Assigned To", on: true, td: "text-sm whitespace-nowrap", cell: (r) => r.assignee ? <span className="inline-flex items-center gap-1.5"><Avatar name={r.assignee.full_name} />{r.assignee.full_name}</span> : <span className="badge bg-amber-50 text-amber-700">Unassigned</span> },
  { key: "status", label: "Status", on: true, sort: true, cell: (r, x) => <StatusPick r={r} onPick={(s) => x.setStatus(r, s)} /> },
  { key: "priority", label: "Priority", on: true, sort: true, td: "text-xs whitespace-nowrap", cell: (r) => <span className="inline-flex items-center gap-1"><PriorityIcon p={r.priority} />{priorityOf(r.priority).label}</span> },
  { key: "created", label: "Created On", on: true, sort: true, td: "text-xs whitespace-nowrap text-slate-600", cell: (r) => fmtDay(r.created_at) },
  { key: "modified", label: "Modified On", on: true, sort: true, td: "text-xs whitespace-nowrap text-slate-600", cell: (r) => fmtDay(r.updated_at) },
  { key: "due", label: "End Date", on: true, sort: true, td: "text-xs whitespace-nowrap", cell: (r) => !r.due_at ? dash : (
      <span title={fmtDateTime(r.due_at)} className={`rounded-md px-2 py-0.5 font-semibold ${isOverdue(r) ? "bg-red-600 text-white" : r.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-navy-900"}`}>{fmtDay(r.due_at)}</span>) },
  { key: "mobile", label: "Customer Mobile Number", on: true, td: "text-xs whitespace-nowrap", cell: (r) => r.lead?.customer ? <span className="flex items-center">{r.lead.customer.phone_e164}<PhoneMenu leadId={r.lead.id} phone={r.lead.customer.phone_e164} /></span> : dash },
  { key: "customer", label: "Customer Name", on: true, td: "text-sm", cell: (r) => r.lead?.customer?.name || dash },
  { key: "lead", label: "Lead", on: false, td: "text-xs", cell: (r) => r.lead ? <Link className="font-medium text-brand-700 hover:underline" href={`/leads/${r.lead.id}`}>LB-{r.lead.lead_no}</Link> : dash },
  { key: "no", label: "Task No.", on: false, sort: true, td: "text-xs text-slate-500", cell: (r) => `T-${r.task_no}` },
  { key: "completed_on", label: "Completed On", on: false, td: "text-xs whitespace-nowrap text-slate-600", cell: (r) => r.completed_at ? fmtDateTime(r.completed_at) : dash },
];
const BY_KEY = new Map(COLS.map((c) => [c.key, c]));
const LABELS = new Map(COLS.map((c) => [c.key, c.label]));
const DEFAULT: ColItem[] = COLS.map((c) => ({ k: c.key, on: c.on }));

function Avatar({ name }: { name: string }) {
  return <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-navy-900 text-[10px] font-bold text-white">{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg viewBox="0 0 12 16" className="ml-1 inline h-3.5 w-2.5 shrink-0" aria-hidden>
      <path d="M6 1 10 6H2z" className={dir === "asc" ? "fill-brand-600" : "fill-slate-300"} />
      <path d="M6 15 2 10h8z" className={dir === "desc" ? "fill-brand-600" : "fill-slate-300"} />
    </svg>
  );
}

function StatusPick({ r, onPick }: { r: TaskRow; onPick: (s: string) => void }) {
  const s = statusOf(r.status);
  return (
    <label className={`relative inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${s.cls}`} title="Change status">
      {s.label}
      <svg viewBox="0 0 10 6" className="h-1.5 w-2 opacity-60"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      <select aria-label="Status" className="absolute inset-0 cursor-pointer opacity-0" value={r.status} onChange={(e) => onPick(e.target.value)}>
        {TASK_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
      </select>
    </label>
  );
}

export function TasksView({ rows, total, page, per, sp, scope, sortKey, sortDir, counts, users, me, admin, manager, saved, openNew, newLead, openTask }: {
  rows: TaskRow[]; total: number; page: number; per: number; sp: Record<string, string>; scope: string; sortKey: string; sortDir: "asc" | "desc";
  counts: { overdue: number; today: number; mine: number }; users: User[]; me: string; admin: boolean; manager: boolean;
  saved: LeadTableLayout | null; openNew: boolean; newLead: LeadHit | null; openTask: TaskRow | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [layout, setLayout] = useState<ColItem[]>(() => mergeLayout(saved, DEFAULT));
  const [customize, setCustomize] = useState(false);
  const [edit, setEdit] = useState<TaskRow | "new" | null>(openTask ?? (openNew ? "new" : null));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<null | "actions" | "assign">(null);
  const [note, setNote] = useState<string | null>(null);
  const [filters, setFilters] = useState(!!(sp.status || sp.priority || sp.to || sp.q));
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 3500); return () => clearTimeout(t); }, [note]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  useEffect(() => { setSel(new Set()); }, [rows]);

  const href = (set: Record<string, string | null>) => {
    const p = new URLSearchParams(sp);
    p.delete("page"); p.delete("task"); p.delete("new"); p.delete("lead");
    for (const [k, v] of Object.entries(set)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const go = (set: Record<string, string | null>) => start(() => router.push(href(set)));
  const closeEdit = () => {
    setEdit(null);
    if (sp.task || sp.new) router.replace(href({}), { scroll: false });
  };

  const setStatus = async (r: TaskRow, s: string) => {
    const res = await setTaskStatus([r.id], s);
    if (res.error) setNote(res.error); else { setNote(`Status: ${statusOf(s).label}`); router.refresh(); }
  };
  const bulkStatus = async (s: string) => {
    setMenu(null);
    const res = await setTaskStatus([...sel], s);
    if (res.error) setNote(res.error); else { setNote(`${res.n} task${res.n === 1 ? "" : "s"} marked ${statusOf(s).label}`); router.refresh(); }
  };
  const bulkAssign = async (uid: string) => {
    setMenu(null);
    const res = await assignTasks([...sel], uid);
    if (res.error) setNote(res.error); else { setNote(`${res.n} task${res.n === 1 ? "" : "s"} reassigned`); router.refresh(); }
  };
  const bulkDelete = async () => {
    setMenu(null);
    if (!window.confirm(`Delete ${sel.size} task${sel.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    const res = await deleteTasks([...sel]);
    if (res.error) setNote(res.error);
    else { setNote(res.n === sel.size ? `${res.n} deleted` : `${res.n} of ${sel.size} deleted. Only the person who created a task, or an admin, can delete it.`); router.refresh(); }
  };

  const visible = layout.filter((i) => i.on).map((i) => BY_KEY.get(i.k)!);
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const th = (k: string, label: string, sortable: boolean) => (
    <th key={k} className="th whitespace-nowrap" aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
      {sortable ? (
        <button type="button" onClick={() => go({ sort: k, dir: sortKey === k ? (sortDir === "asc" ? "desc" : "asc") : (k === "due" || k === "task" ? "asc" : "desc") })}
          className="inline-flex items-center uppercase hover:text-navy-900" title={`Sort by ${label}`}>
          {label}<SortIcon dir={sortKey === k ? sortDir : null} />
        </button>
      ) : label}
    </th>
  );

  const tool = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-navy-900 hover:border-slate-300 disabled:opacity-50";
  const purple = "inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300";
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-navy-900 hover:bg-slate-100";
  const caret = <svg viewBox="0 0 10 6" className="h-2 w-2.5"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
  const pages = Math.max(1, Math.ceil(total / per));

  return (
    <div className={pending ? "opacity-70 transition-opacity" : ""}>
      {/* Toolbar */}
      <div ref={bar} className="card mb-2 flex flex-wrap items-center gap-2 p-2">
        <div className="mr-1 flex items-center gap-2 pl-1">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-700"><Icon name="check" className="h-4 w-4" /></span>
          <span className="font-semibold text-navy-900">Tasks</span>
          <span className="text-xs text-slate-500">{total.toLocaleString("en-IN")}</span>
        </div>
        <button type="button" className={purple} onClick={() => setCustomize(true)}><Icon name="sliders" className="h-3.5 w-3.5" />Customize Table</button>
        <div className="relative">
          <button type="button" className={purple} disabled={sel.size === 0} onClick={() => setMenu(menu === "actions" ? null : "actions")} aria-expanded={menu === "actions"}
            title={sel.size ? `${sel.size} selected` : "Tick tasks first"}>
            Actions{sel.size > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px]">{sel.size}</span>} {caret}
          </button>
          {menu === "actions" && (
            <div role="menu" className="absolute left-0 z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase text-slate-400">Mark as</div>
              {TASK_STATUSES.map((s) => <button key={s.value} role="menuitem" type="button" className={item} onClick={() => bulkStatus(s.value)}><span className={`rounded px-1.5 text-[10px] font-bold uppercase ${s.cls}`}>{s.label}</span></button>)}
              <div className="my-1 border-t border-slate-100" />
              <button role="menuitem" type="button" className={item} onClick={() => setMenu("assign")}><Icon name="userPlus" className="h-4 w-4 text-sky-600" />Reassign to…</button>
              <button role="menuitem" type="button" className={`${item} text-red-700`} onClick={bulkDelete}><Icon name="trash" className="h-4 w-4" />Delete</button>
            </div>
          )}
          {menu === "assign" && (
            <div role="menu" className="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase text-slate-400">Reassign {sel.size} to</div>
              {users.map((u) => <button key={u.id} role="menuitem" type="button" className={item} onClick={() => bulkAssign(u.id)}><Avatar name={u.name} />{u.name}{u.id === me ? " (me)" : ""}</button>)}
            </div>
          )}
        </div>
        <button type="button" className={purple} onClick={() => setEdit("new")}><Icon name="plus" className="h-3.5 w-3.5" />Add</button>
        <button type="button" className={`${purple} px-2`} title="Refresh" aria-label="Refresh" onClick={() => start(() => router.refresh())}>
          <Icon name="refresh" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        </button>
        <button type="button" className={`${tool} ${filters ? "border-brand-300 bg-brand-50 text-brand-800" : ""}`} onClick={() => setFilters((f) => !f)} aria-expanded={filters}>
          <Icon name="filter" className="h-3.5 w-3.5" />Filters
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {counts.overdue > 0 && sp.due !== "overdue" && (
            <Link href={href({ due: "overdue" })} className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">{counts.overdue} overdue</Link>
          )}
          <select aria-label="Filter tasks by end date" className={`rounded-lg border px-2.5 py-1.5 text-sm ${sp.due ? "border-red-300 text-red-700" : "border-slate-200 text-navy-900"}`}
            value={sp.due ?? ""} onChange={(e) => go({ due: e.target.value || null })}>
            {TASK_DUE_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.value === "" ? "Filter Overdue Tasks" : f.label}{f.value === "overdue" ? ` (${counts.overdue})` : f.value === "today" ? ` (${counts.today})` : ""}</option>)}
          </select>
        </div>
      </div>

      {/* Whose tasks */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {TASK_SCOPES.map((s) => (
          <Link key={s.value} href={href({ scope: s.value === "all" ? null : s.value })}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${scope === s.value ? "border-violet-300 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-navy-900 hover:border-violet-200"}`}>
            {s.value === "all" && !admin && !manager ? "All my tasks" : s.label}
            {s.value === "to_me" && counts.mine > 0 && <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">{counts.mine}</span>}
          </Link>
        ))}
      </div>

      {/* Search + filters */}
      {filters && (
        <form action="/tasks" className="card mb-2 grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="relative col-span-2">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" name="q" defaultValue={sp.q} placeholder="Search task or description" />
          </div>
          <select className="input" name="status" defaultValue={sp.status ?? ""}><option value="">Any status</option>{TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          <select className="input" name="priority" defaultValue={sp.priority ?? ""}><option value="">Any priority</option>{TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          {(admin || manager) && <select className="input" name="to" defaultValue={sp.to ?? ""}><option value="">Anyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
          {["scope", "due", "sort", "dir", "per"].map((k) => sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null)}
          <div className="flex gap-2">
            <button className="btn-primary flex-1"><Icon name="search" className="h-3.5 w-3.5" />Apply</button>
            <Link href="/tasks" className="btn-ghost">Clear</Link>
          </div>
        </form>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-4 py-12 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-700"><Icon name="check" className="h-5 w-5" /></span>
          <div className="font-semibold text-navy-900">No tasks here</div>
          <p className="max-w-sm text-sm text-slate-500">{Object.keys(sp).length ? "Nothing matches these filters." : "Create a task and assign it to yourself or a teammate. They get a notification."}</p>
          <button type="button" className="btn-primary mt-1" onClick={() => setEdit("new")}><Icon name="plus" className="h-3.5 w-3.5" />Add task</button>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                <th className="th">Actions</th>
                {th("task", "Task", true)}
                {visible.map((c) => th(c.key, c.label, !!c.sort))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className={isOverdue(r) ? "bg-red-50/30 hover:bg-red-50/60" : "hover:bg-slate-50"}>
                  <td className="td"><input type="checkbox" aria-label={`Select ${r.title}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="td">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setEdit(r)} title="Open / edit task" aria-label="Edit task" className="grid h-6 w-6 place-items-center rounded-full bg-violet-600 text-white hover:bg-violet-700"><Icon name="pencil" className="h-3 w-3" /></button>
                      {r.lead && <Link href={`/leads/${r.lead.id}`} title={`Open lead LB-${r.lead.lead_no}`} aria-label="Open lead" className="grid h-6 w-6 place-items-center rounded-full bg-orange-500 text-white hover:bg-orange-600"><Icon name="user" className="h-3 w-3" /></Link>}
                    </div>
                  </td>
                  <td className="td min-w-[180px]">
                    <button type="button" onClick={() => setEdit(r)} className="flex items-start gap-1.5 text-left font-medium text-navy-900 hover:text-violet-700">
                      <PriorityIcon p={r.priority} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className={r.status === "completed" || r.status === "cancelled" ? "text-slate-500 line-through" : ""}>{r.title}</span>
                    </button>
                  </td>
                  {visible.map((c) => <td key={c.key} className={`td ${c.td ?? ""}`}>{c.cell(r, { setStatus })}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: count, rows per page, page numbers */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-navy-900">{total.toLocaleString("en-IN")} Task{total === 1 ? "" : "s"}</span>
          <label className="inline-flex items-center gap-2">Show
            <select aria-label="Rows per page" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-navy-900" value={per} onChange={(e) => go({ per: e.target.value === "20" ? null : e.target.value })}>
              {TASK_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>rows per page
          </label>
          <span className="hidden text-xs text-violet-700 md:inline">ⓘ Click a column header to sort</span>
        </div>
        {pages > 1 && <Pages page={page} pages={pages} href={(n) => href({ page: n > 1 ? String(n) : null })} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold uppercase text-navy-900">
        {TASK_PRIORITIES.map((p) => <span key={p.value} className="inline-flex items-center gap-1"><PriorityIcon p={p.value} />{p.label}</span>)}
      </div>

      {customize && <CustomizeTable labels={LABELS} defaults={DEFAULT} first="Task" initial={layout} save={(l) => saveTableLayout("tasks.table", l)}
        onClose={() => setCustomize(false)} onSaved={(l) => { setLayout(l); setCustomize(false); }} />}
      {edit && <TaskModal task={edit === "new" ? null : edit} users={users} me={me} canDelete={edit !== "new" && (admin || edit.assigned_by === me)}
        newLead={edit === "new" ? newLead : null} onClose={closeEdit} onDeleted={() => { closeEdit(); setNote("Task deleted"); router.refresh(); }} />}
      {note && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-navy-900 px-4 py-2 text-sm text-white shadow-lg">{note}</div>}
    </div>
  );
}

function Pages({ page, pages, href }: { page: number; pages: number; href: (n: number) => string }) {
  const nums: (number | "…")[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) nums.push(n);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const cls = "grid h-8 min-w-8 place-items-center rounded-lg px-2 text-sm";
  const nav = (n: number, label: string, text: string) => n < 1 || n > pages || n === page
    ? <span className={`${cls} text-slate-300`} aria-hidden>{text}</span>
    : <Link className={`${cls} text-navy-900 hover:bg-slate-100`} href={href(n)} aria-label={label}>{text}</Link>;
  return (
    <nav className="flex items-center gap-1" aria-label="Pages">
      {nav(1, "First page", "«")}{nav(page - 1, "Previous page", "‹")}
      {nums.map((n, i) => n === "…" ? <span key={`e${i}`} className="px-1 text-slate-400">…</span>
        : <Link key={n} href={href(n)} aria-current={n === page ? "page" : undefined} className={`${cls} ${n === page ? "bg-violet-600 font-semibold text-white" : "text-navy-900 hover:bg-slate-100"}`}>{n}</Link>)}
      {nav(page + 1, "Next page", "›")}{nav(pages, "Last page", "»")}
    </nav>
  );
}

function TaskModal({ task, users, me, canDelete, newLead, onClose, onDeleted }: {
  task: TaskRow | null; users: User[]; me: string; canDelete: boolean; newLead: LeadHit | null; onClose: () => void; onDeleted: () => void;
}) {
  const initialLead: LeadHit | null = task?.lead ? { id: task.lead.id, lead_no: task.lead.lead_no, name: task.lead.customer?.name ?? null, phone: task.lead.customer?.phone_e164 ?? "" } : newLead;
  const [lead, setLead] = useState<LeadHit | null>(initialLead);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchTaskLeads(term);
      if (live) { setHits(r); setSearching(false); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  // Assignee list keeps an inactive / missing current assignee selectable.
  const assignees = task?.assigned_to && !users.some((u) => u.id === task.assigned_to)
    ? [...users, { id: task.assigned_to, name: task.assignee?.full_name ?? "Former user" }] : users;

  return (
    <Modal open onClose={onClose} title={task ? `Task T-${task.task_no}` : "Add task"} wide>
      <ActionForm action={saveTask} onOk={onClose} className="space-y-3">
        {task && <input type="hidden" name="id" value={task.id} />}
        {lead && <input type="hidden" name="lead_id" value={lead.id} />}
        <Field label="Task *"><input className="input" name="title" required maxLength={200} defaultValue={task?.title ?? (newLead ? `Follow up with ${newLead.name || newLead.phone}` : "")} autoFocus={!task} placeholder="e.g. Send quotation to Sai Snappe" /></Field>
        <Field label="Description"><textarea className="input min-h-24" name="description" maxLength={4000} defaultValue={task?.description ?? ""} placeholder="Details, steps, phone number…" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assign to *">
            <select className="input" name="assigned_to" required defaultValue={task?.assigned_to ?? me}>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me ? " (me)" : ""}</option>)}
            </select>
          </Field>
          <Field label="End date">
            <input className="input" type="datetime-local" name="due" defaultValue={toLocalInput(task?.due_at)} />
          </Field>
          <Field label="Priority">
            <select className="input" name="priority" defaultValue={String(task?.priority ?? 3)}>
              {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" name="status" defaultValue={task?.status ?? "created"}>
              {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Customer / lead (optional)">
          {lead ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span><span className="font-medium text-brand-700">LB-{lead.lead_no}</span> · {lead.name || "—"} · <span className="text-slate-500">{lead.phone}</span></span>
              <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => setLead(null)}>Remove</button>
            </div>
          ) : (
            <div className="relative">
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile or LB-123"
                onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
              {focus && (hits.length > 0 || (q.trim().length >= 2 && !searching)) && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  {hits.length === 0 ? <div className="px-2.5 py-2 text-sm text-slate-500">No lead found</div> : hits.map((h) => (
                    <button key={h.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-100" onMouseDown={(e) => e.preventDefault()} onClick={() => { setLead(h); setQ(""); setHits([]); }}>
                      <span className="font-medium text-brand-700">LB-{h.lead_no}</span><span className="text-navy-900">{h.name || "—"}</span><span className="ml-auto text-xs text-slate-500">{h.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
        {task && (
          <div className="grid gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:grid-cols-2">
            <span>Assigned by <b className="text-navy-900">{task.assigner?.full_name ?? "—"}</b></span>
            <span>Created {fmtDateTime(task.created_at)}</span>
            <span>Last modified {fmtDateTime(task.updated_at)}</span>
            {task.completed_at && <span>Completed {fmtDateTime(task.completed_at)}</span>}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          {task && canDelete && (
            <button type="button" disabled={deleting} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              onClick={() => { if (!window.confirm("Delete this task?")) return; startDelete(async () => { const r = await deleteTasks([task.id]); if (r.error || !r.n) setDelErr(r.error ?? "Could not delete"); else onDeleted(); }); }}>
              <Icon name="trash" className="h-3.5 w-3.5" />{deleting ? "Deleting…" : "Delete"}
            </button>
          )}
          {delErr && <span className="text-xs text-red-600">{delErr}</span>}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <Submit pendingText="Saving…">{task ? "Save" : "Add task"}</Submit>
          </div>
        </div>
      </ActionForm>
    </Modal>
  );
}
