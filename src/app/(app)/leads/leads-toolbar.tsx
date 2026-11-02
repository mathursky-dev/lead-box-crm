"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/kit";
import { saveLeadViews, type LeadViews } from "@/lib/actions/prefs";

// Leads page toolbar: saved filter tabs ("Filter By Reports"), Add / More menus,
// refresh, Customize Table, Advanced Filter, Export, All↔Untouched and
// Active↔Deleted switches. The search box and the filter panel sit under it; the
// panel stays in the DOM while closed so a search still submits every filter.

type View = LeadViews["views"][number];
// Params that do not change which leads match (paging, sort, page size).
const NOT_FILTERS = new Set(["offset", "per", "sort", "dir"]);
const norm = (qs: string) => {
  const q = new URLSearchParams(qs);
  return [...q.entries()].filter(([k, v]) => v && !NOT_FILTERS.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
};

export function LeadsToolbar({ qs, views: initialViews, total, q, activeFilters, untouched, deleted, perm, exportHref, children }: {
  qs: string; views: View[]; total: number; q?: string; activeFilters: number; untouched: boolean; deleted: boolean;
  perm: { create: boolean; import: boolean; export: boolean; admin: boolean }; exportHref: string; children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<View[]>(initialViews);
  const [menu, setMenu] = useState<null | "add" | "more" | "save">(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close); window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [menu]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 3500); return () => clearTimeout(t); }, [note]);

  const current = norm(qs);
  const href = (set: Record<string, string | null>) => {
    const p = new URLSearchParams(qs);
    p.delete("offset");
    for (const [k, v] of Object.entries(set)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `/leads?${s}` : "/leads";
  };
  const persist = async (next: View[]) => {
    const prev = views;
    setViews(next);
    const res = await saveLeadViews({ v: 1, views: next });
    if (res.error) { setViews(prev); setNote(res.error); }
  };
  const saveView = async () => {
    const n = name.trim();
    if (!n) return;
    if (!current) { setNote("Apply some filters first, then save them as a tab."); return; }
    await persist([...views, { id: crypto.randomUUID().slice(0, 8), name: n, qs: current }]);
    setName(""); setMenu(null); setNote(`Saved "${n}"`);
  };

  const tab = (active: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-violet-300 bg-violet-100 text-violet-800" : "border-slate-200 bg-white text-navy-900 hover:border-violet-200"}`;
  const tool = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-navy-900 hover:border-slate-300";
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-navy-900 hover:bg-slate-100";

  return (
    <div className="mb-3" ref={bar}>
      {/* Saved filter tabs */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Link href="/leads" className={tab(!current)}>All Leads</Link>
        {views.map((v) => (
          <span key={v.id} className={`${tab(current === v.qs)} pr-1.5`}>
            <Link href={`/leads?${v.qs}`}>{v.name}</Link>
            <button type="button" aria-label={`Remove ${v.name}`} title="Remove tab" className="grid h-4 w-4 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-red-600"
              onClick={() => persist(views.filter((x) => x.id !== v.id))}>×</button>
          </span>
        ))}
        <div className="relative">
          <button type="button" className={`${tab(false)} border-dashed border-violet-300 text-violet-700`} onClick={() => setMenu(menu === "save" ? null : "save")} aria-expanded={menu === "save"}>
            Filter By Reports <Icon name="plus" className="h-3 w-3" />
          </button>
          {menu === "save" && (
            <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <div className="mb-1 text-sm font-semibold text-navy-900">Save current filters as a tab</div>
              <p className="mb-2 text-xs text-slate-500">{current ? "Search, filters, period and Untouched/Deleted are saved. Only you see your tabs." : "No filters applied yet. Use Advanced Filter, status cards or search first."}</p>
              <form onSubmit={(e) => { e.preventDefault(); void saveView(); }} className="flex gap-2">
                <input className="input" autoFocus maxLength={40} placeholder="Tab name, e.g. Hot follow-ups" value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn-primary" disabled={!name.trim() || !current || views.length >= 20}>Save</button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="card flex flex-wrap items-center gap-2 p-2">
        <div className="mr-1 flex items-center gap-2 pl-1">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon name="target" className="h-4 w-4" /></span>
          <span className="font-semibold text-navy-900">Leads</span>
          <span className="text-xs text-slate-500">{total.toLocaleString("en-IN")}</span>
        </div>
        {(perm.create || perm.import) && (
          <div className="relative">
            <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700" onClick={() => setMenu(menu === "add" ? null : "add")} aria-expanded={menu === "add"}>
              Add <svg viewBox="0 0 10 6" className="h-2 w-2.5"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
            {menu === "add" && (
              <div role="menu" className="absolute left-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                {perm.create && <Link role="menuitem" className={item} href="/leads/new"><Icon name="plus" className="h-4 w-4 text-brand-600" />New lead</Link>}
                {perm.import && <Link role="menuitem" className={item} href="/import"><Icon name="upload" className="h-4 w-4 text-sky-600" />Import leads (CSV)</Link>}
              </div>
            )}
          </div>
        )}
        <div className="relative">
          <button type="button" className={tool} onClick={() => setMenu(menu === "more" ? null : "more")} aria-expanded={menu === "more"}>More <span className="tracking-widest">⋯</span></button>
          {menu === "more" && (
            <div role="menu" className="absolute left-0 z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <Link role="menuitem" className={item} href="/followups"><Icon name="calendar" className="h-4 w-4 text-orange-500" />Follow-ups</Link>
              <Link role="menuitem" className={item} href={href({ followup: "overdue" })}><Icon name="alert" className="h-4 w-4 text-red-500" />Overdue follow-ups</Link>
              <Link role="menuitem" className={item} href={href({ seen: "unseen" })}><Icon name="eye" className="h-4 w-4 text-sky-600" />Unseen by owner</Link>
              <Link role="menuitem" className={item} href="/analytics"><Icon name="chart" className="h-4 w-4 text-violet-600" />Lead analytics</Link>
              {perm.admin && <>
                <div className="my-1 border-t border-slate-100" />
                <Link role="menuitem" className={item} href="/settings/statuses"><Icon name="tag" className="h-4 w-4 text-slate-500" />Lead statuses</Link>
                <Link role="menuitem" className={item} href="/admin/allocation"><Icon name="userPlus" className="h-4 w-4 text-slate-500" />Lead allocation</Link>
                <Link role="menuitem" className={item} href="/settings/sources"><Icon name="layers" className="h-4 w-4 text-slate-500" />Sources & tags</Link>
              </>}
            </div>
          )}
        </div>
        <button type="button" className={`${tool} px-2`} title="Refresh" aria-label="Refresh" onClick={() => start(() => router.refresh())}>
          <Icon name="refresh" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        </button>
        <button type="button" className={tool} onClick={() => window.dispatchEvent(new Event("leads:customize"))}>Customize Table</button>
        <button type="button" className={`${tool} ${open || activeFilters ? "border-brand-300 bg-brand-50 text-brand-800" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Advanced Filter
          {activeFilters > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{activeFilters}</span>}
        </button>
        {perm.export && <a className={tool} href={exportHref}>Export / Download</a>}
        <Switch left="All" right="Untouched" on={untouched} href={href({ untouched: untouched ? null : "1" })} title="Untouched: owned open leads with no action by the owner since assignment" />
        {perm.admin && <Switch left="Active" right="Deleted" on={deleted} href={href({ deleted: deleted ? null : "1" })} title="Show deleted leads (admins can restore them)" />}
      </div>

      {/* Search + filter panel */}
      <form action="/leads" className="card mt-2 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" name="q" defaultValue={q} placeholder="Search name, phone, email, LB-123" />
          </div>
          {untouched && <input type="hidden" name="untouched" value="1" />}
          {deleted && <input type="hidden" name="deleted" value="1" />}
          <button className="btn-primary"><Icon name="search" className="h-3.5 w-3.5" />Search</button>
          {q && <Link href={href({ q: null })} className="btn-ghost">Clear search</Link>}
        </div>
        <div className={open ? "mt-2.5 border-t border-slate-100 pt-2.5" : "hidden"}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
          <div className="mt-2 flex justify-end gap-2">
            <Link href="/leads" className="btn-ghost">Clear all</Link>
            <button className="btn-primary"><Icon name="filter" className="h-3.5 w-3.5" />Apply</button>
          </div>
        </div>
      </form>
      {note && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-navy-900 px-4 py-2 text-sm text-white shadow-lg">{note}</div>}
    </div>
  );
}

function Switch({ left, right, on, href, title }: { left: string; right: string; on: boolean; href: string; title: string }) {
  return (
    <Link href={href} title={title} role="switch" aria-checked={on}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 hover:border-slate-300">
      <span className={on ? "" : "font-semibold text-navy-900"}>{left}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${on ? "bg-violet-600" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span className={on ? "font-semibold text-navy-900" : ""}>{right}</span>
    </Link>
  );
}

export function CustomizeButton() {
  return <button type="button" className="btn-ghost" onClick={() => window.dispatchEvent(new Event("leads:customize"))}><Icon name="sliders" className="h-3.5 w-3.5" />Customize Table</button>;
}
