"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { saveLeadCardsPref, type LeadCardsPref } from "@/lib/actions/prefs";

// Coloured count card per lead status at the top of the leads page. A card is a
// link that filters the list to that status (click again to clear). Users can pin
// which statuses show, hide the cards, and pick the period the counts cover;
// pin + hide are saved per login.

export type Card = { id: string; name: string; category: string; count: number };
export const RANGES = [
  { v: "", label: "All time" }, { v: "today", label: "Today" }, { v: "7", label: "Last 7 days" },
  { v: "30", label: "Last 30 days" }, { v: "90", label: "Last 90 days" },
];

// Soft gradient + strong number colour, picked by status category, then varied by position.
const TONES = [
  { bg: "from-pink-50 to-fuchsia-100/70", num: "text-fuchsia-600", ic: "bg-fuchsia-100 text-fuchsia-600" },
  { bg: "from-lime-50 to-green-100/70", num: "text-green-600", ic: "bg-green-100 text-green-600" },
  { bg: "from-slate-50 to-teal-50", num: "text-teal-600", ic: "bg-teal-100 text-teal-600" },
  { bg: "from-violet-50 to-purple-100/70", num: "text-purple-600", ic: "bg-purple-100 text-purple-600" },
  { bg: "from-indigo-50 to-violet-100/70", num: "text-indigo-600", ic: "bg-indigo-100 text-indigo-600" },
  { bg: "from-sky-50 to-blue-100/70", num: "text-sky-600", ic: "bg-sky-100 text-sky-600" },
  { bg: "from-amber-50 to-orange-100/70", num: "text-orange-600", ic: "bg-orange-100 text-orange-600" },
  { bg: "from-rose-50 to-red-100/70", num: "text-red-600", ic: "bg-red-100 text-red-600" },
];
const BY_CAT: Record<string, number> = { new: 5, assigned: 4, contacted: 3, interested: 6, follow_up: 0, scheduled: 2, won: 1, lost: 7, invalid: 7 };
const ICON: Record<string, string> = { new: "sparkle", assigned: "user", contacted: "phone", interested: "heart", follow_up: "clock", scheduled: "calendar", won: "trophy", lost: "x", invalid: "ban" };

export function StatusCards({ cards, total, activeId, range, baseQs, pref }: {
  cards: Card[]; total: number; activeId: string | null; range: string; baseQs: string; pref: LeadCardsPref | null;
}) {
  const router = useRouter();
  const [pinned, setPinned] = useState<string[] | null>(pref?.pinned ?? null);
  const [hidden, setHidden] = useState(pref?.hidden ?? false);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const persist = (p: string[] | null, h: boolean) => { void saveLeadCardsPref({ v: 1, pinned: p, hidden: h }); };
  const shown = pinned ? cards.filter((c) => pinned.includes(c.id)) : cards;
  const flip = (id: string) => {
    const cur = pinned ?? cards.map((c) => c.id);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const val = next.length === cards.length ? null : next;
    setPinned(val); persist(val, hidden);
  };
  const href = (statusId: string | null, r = range) => {
    const q = new URLSearchParams(baseQs);
    q.delete("status_id"); q.delete("offset"); q.delete("range");
    if (statusId) q.set("status_id", statusId);
    if (r) q.set("range", r);
    const s = q.toString();
    return s ? `/leads?${s}` : "/leads";
  };
  const pinnedLabel = pinned === null ? "All statuses" : cards.filter((c) => pinned.includes(c.id)).map((c) => c.name).join(", ") || "None";

  return (
    <section className="mb-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <div className="relative" ref={box}>
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex max-w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-navy-900 hover:border-slate-300">
            <span className="grid h-5 w-5 place-items-center rounded bg-violet-600 text-white"><Icon name="tag" className="h-3 w-3" /></span>
            Pin statuses <span className="truncate font-normal text-slate-500">{pinnedLabel}</span>
            <svg viewBox="0 0 10 6" className="h-2 w-2.5 shrink-0 text-slate-500"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
          {open && (
            <div className="absolute left-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show cards for</span>
                <button type="button" className="text-[11px] text-brand-700 hover:underline" onClick={() => { setPinned(null); persist(null, hidden); }}>All</button>
              </div>
              {cards.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="accent-brand-600" checked={pinned === null || pinned.includes(c.id)} onChange={() => flip(c.id)} />
                  <span className="flex-1">{c.name}</span><span className="text-xs text-slate-400">{c.count}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700">{shown.length} shown</span>
        <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-navy-900 hover:border-slate-300"
          onClick={() => { setHidden(!hidden); persist(pinned, !hidden); }}>
          {hidden ? "Show cards" : "Hide cards"}
          <svg viewBox="0 0 10 6" className={`h-2 w-2.5 ${hidden ? "" : "rotate-180"}`}><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <label className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1 font-medium text-violet-700">
          <Icon name="calendar" className="h-3.5 w-3.5" />
          <select aria-label="Period" className="cursor-pointer bg-transparent py-0.5 focus:outline-none" value={range} onChange={(e) => start(() => router.push(href(activeId, e.target.value)))}>
            {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
        </label>
      </div>
      {!hidden && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          <CardLink href={href(null)} active={!activeId} tone={{ bg: "from-white to-slate-100", num: "text-navy-900", ic: "bg-navy-900 text-white" }} icon="target" count={total} name="All leads" />
          {shown.map((c, i) => {
            const t = TONES[((BY_CAT[c.category] ?? i) + Math.floor(i / 8)) % TONES.length];
            return <CardLink key={c.id} href={href(activeId === c.id ? null : c.id)} active={activeId === c.id} tone={t} icon={ICON[c.category] ?? "tag"} count={c.count} name={c.name} />;
          })}
        </div>
      )}
    </section>
  );
}

function CardLink({ href, active, tone, icon, count, name }: { href: string; active: boolean; tone: (typeof TONES)[number]; icon: string; count: number; name: string }) {
  return (
    <Link href={href} title={active ? `Showing ${name} · click to clear` : `Show ${name} leads`}
      className={`flex items-center gap-2.5 rounded-xl border bg-gradient-to-br px-3 py-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow ${tone.bg} ${active ? "border-brand-500 ring-2 ring-brand-500/30" : "border-white/80"}`}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone.ic}`}><Icon name={icon} className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className={`block text-lg font-bold leading-tight ${tone.num}`}>{count}</span>
        <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">{name}</span>
      </span>
    </Link>
  );
}
