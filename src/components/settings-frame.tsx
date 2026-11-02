"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./kit";
import type { SettingsGroup, SettingsLink } from "@/lib/settings-nav";

const CHIP: Record<string, string> = {
  navy: "bg-navy-900 text-white", green: "bg-brand-500 text-white", amber: "bg-amber-500 text-white",
  violet: "bg-violet-500 text-white", blue: "bg-sky-500 text-white",
};

/** Most specific settings link for the current path (so /settings/statuses does not light up /settings). */
function activeLink(groups: SettingsGroup[], path: string): SettingsLink | undefined {
  return groups.flatMap((g) => g.links)
    .filter((l) => path === l.href || path.startsWith(l.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

function GroupedList({ groups, active, onPick }: { groups: SettingsGroup[]; active?: string; onPick?: () => void }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>
          <ul className="space-y-0.5">
            {g.links.map((l) => {
              const on = l.href === active;
              return (
                <li key={l.href}>
                  <Link href={l.href} onClick={onPick} aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${on ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-navy-900"}`}>
                    <Icon name={l.icon} className={`h-4 w-4 shrink-0 ${on ? "text-brand-600" : "text-slate-400"}`} />
                    <span className="truncate">{l.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Wraps every settings page: a vertical, grouped list on the left (desktop) and a
 * "Settings › Page" bar with a drop-down list (phone). No horizontal tab strip.
 * The hub itself (/settings) is shown full width.
 */
export function SettingsFrame({ groups, children }: { groups: SettingsGroup[]; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  if (path === "/settings") return <>{children}</>;
  const cur = activeLink(groups, path);
  return (
    <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-6">
      <aside className="max-lg:hidden">
        <div className="sticky top-0 max-h-[calc(100vh-7rem)] overflow-y-auto pb-4 pr-1">
          <Link href="/settings" className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-navy-900 hover:border-brand-200 hover:bg-brand-50">
            <Icon name="grid" className="h-4 w-4 text-brand-600" />All settings
          </Link>
          <GroupedList groups={groups} active={cur?.href} />
        </div>
      </aside>
      <div className="min-w-0">
        <div className="relative mb-4 lg:hidden">
          <div className="flex items-center gap-2 text-sm">
            <Link href="/settings" className="inline-flex items-center gap-1 font-medium text-brand-700"><Icon name="chevronLeft" className="h-4 w-4" />Settings</Link>
            <span className="text-slate-300">/</span>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="inline-flex min-w-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-navy-900">
              <span className="truncate">{cur?.label ?? "Settings"}</span><Icon name="chevronDown" className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          </div>
          {open && (
            <div className="absolute inset-x-0 z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <GroupedList groups={groups} active={cur?.href} onPick={() => setOpen(false)} />
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The Settings hub: every option on one screen, grouped in cards, with a search box. */
export function SettingsHub({ groups }: { groups: SettingsGroup[] }) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, links: !t || g.label.toLowerCase().includes(t) ? g.links : g.links.filter((l) => `${l.label} ${l.desc} ${l.keywords ?? ""}`.toLowerCase().includes(t)) }))
    .filter((g) => g.links.length);
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy-900">Settings</h1>
          <p className="text-sm text-slate-500">Every setting in one place. Pick an option to open it.</p>
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search settings</span>
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-8" placeholder="Search settings…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((g) => (
          <section key={g.label} className="card overflow-hidden">
            <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
              <span className={`grid h-7 w-7 place-items-center rounded-md ${CHIP[g.tone] ?? CHIP.green}`}><Icon name={g.icon} className="h-3.5 w-3.5" /></span>
              {g.label}
            </h2>
            <ul className="divide-y divide-slate-100">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <Icon name={l.icon} className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-navy-900">{l.label}</span>
                      <span className="block truncate text-xs text-slate-500">{l.desc}</span>
                    </span>
                    <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-600" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {shown.length === 0 && <p className="card px-4 py-6 text-center text-sm text-slate-500">No setting matches “{q}”.</p>}
    </div>
  );
}
