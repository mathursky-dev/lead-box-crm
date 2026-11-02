"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/kit";

// Compact filter bar: search box + one "Advanced Filter" button. The full set of
// filters lives in a panel that opens under the bar; it stays in the DOM while
// closed so a search still submits every active filter.
export function FilterBar({ q, active, children }: { q?: string; active: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <form className="card mb-3 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-8" name="q" defaultValue={q} placeholder="Search name, phone, email, LB-123" />
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${open || active ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-navy-900 hover:border-slate-300"}`}>
          <Icon name="filter" className="h-3.5 w-3.5" />Advanced Filter
          {active > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{active}</span>}
          <svg viewBox="0 0 10 6" className={`h-2 w-2.5 ${open ? "rotate-180" : ""}`}><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <button className="btn-primary"><Icon name="search" className="h-3.5 w-3.5" />Search</button>
        {active > 0 && <Link href="/leads" className="btn-ghost">Clear</Link>}
      </div>
      <div className={open ? "mt-2.5 border-t border-slate-100 pt-2.5" : "hidden"}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
        <div className="mt-2 flex justify-end gap-2">
          <Link href="/leads" className="btn-ghost">Clear all</Link>
          <button className="btn-primary"><Icon name="filter" className="h-3.5 w-3.5" />Apply</button>
        </div>
      </div>
    </form>
  );
}
