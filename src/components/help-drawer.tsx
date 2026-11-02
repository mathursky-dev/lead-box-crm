"use client";
import Link from "next/link";
import { useState } from "react";
import { FEATURES, GUIDE_CATS, CAT_ICON, searchFeatures, type GuideCat } from "@/lib/feature-guide";
import { Icon } from "./kit";
import { Inline } from "./guide-text";
import { HelpBot } from "./help-bot";

// Help & Guides drawer: the feature guide (src/lib/feature-guide.ts) for pages this user can open, plus the Ask AI help bot.

export function HelpDrawer({ allowed, onClose }: { allowed: string[]; onClose: () => void }) {
  const [tab, setTab] = useState<"ai" | "guides">("ai");
  const [cat, setCat] = useState<GuideCat | "All">("All");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const t = q.trim();
  // Only guides for pages this user can open (same list as the sidebar and Quick Create).
  const mine = FEATURES.filter((g) => allowed.some((a) => g.href === a || g.href.startsWith(a + "/") || g.href.split("?")[0] === a));
  const cats = GUIDE_CATS.filter((c) => mine.some((f) => f.cat === c));
  const shown = t ? searchFeatures(mine, t, 30) : mine.filter((g) => cat === "All" || g.cat === cat);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/40" onMouseDown={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <aside role="dialog" aria-label="Help & Guides" className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 bg-gradient-to-b from-brand-50 to-white p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-brand-600 text-white"><Icon name="book" className="h-5 w-5" /></span>
              <div>
                <h2 className="text-lg font-semibold text-navy-900">Help &amp; Guides</h2>
                <p className="text-xs text-slate-500">Ask AI, or browse step-by-step guides for every feature.</p>
              </div>
            </div>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close" onClick={onClose}><Icon name="x" className="h-5 w-5" /></button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
            {([["ai", "Ask AI", "sparkle"], ["guides", "Guides", "book"]] as const).map(([k, label, icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold transition ${tab === k ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-navy-900"}`}>
                <Icon name={icon} className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
          {tab === "guides" && (
            <>
              <div className="relative mt-3">
                <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input autoFocus className="input pl-9" placeholder="Search guides: templates, import, chatbots…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
                {(["All", ...cats] as const).map((c) => (
                  <button key={c} onClick={() => { setCat(c); setQ(""); }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${cat === c && !t ? "border-transparent bg-brand-600 text-white shadow" : "border-slate-200 bg-white text-navy-900 hover:bg-slate-50"}`}>
                    <Icon name={c === "All" ? "grid" : CAT_ICON[c]} className="h-3.5 w-3.5" />{c === "All" ? "All Guides" : c}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {tab === "ai" ? (
          <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5"><HelpBot onNavigate={onClose} tall /></div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 md:p-5">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Guides ({shown.length})</div>
            {shown.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No guide matches “{q}”. Try the Ask AI tab.</p>}
            {shown.map((g) => {
              const isOpen = open === g.id;
              return (
                <div key={g.id} className="rounded-xl border border-slate-200">
                  <button className="flex w-full items-start gap-3 p-3 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.id)}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={g.icon} className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-navy-900">{g.title}<span className="badge bg-violet-50 text-violet-700">{g.steps.length} steps</span></span>
                      <span className={`block text-xs text-slate-500 ${isOpen ? "" : "line-clamp-2"}`}>{g.what}</span>
                    </span>
                    <Icon name={isOpen ? "chevronDown" : "chevronRight"} className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 px-3 pb-3 pt-2 text-sm">
                      <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-700">{g.steps.map((s, i) => <li key={i}><Inline text={s} onNavigate={onClose} /></li>)}</ol>
                      {g.tips?.map((tip, i) => <p key={i} className="mb-2 text-xs text-amber-800"><b>Tip:</b> <Inline text={tip} onNavigate={onClose} /></p>)}
                      <Link href={g.href} onClick={onClose} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Open page <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 md:px-5">
          <Link href="/guide" onClick={onClose} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"><Icon name="book" className="h-4 w-4" /> All features &amp; guide</Link>
          <span className="ml-auto">Press <kbd className="rounded border border-slate-200 px-1.5 font-mono">?</kbd> anytime · <kbd className="rounded border border-slate-200 px-1.5 font-mono">Ctrl K</kbd> to search</span>
        </div>
      </aside>
    </div>
  );
}
