"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FEATURES, GUIDE_CATS, CAT_ICON, searchFeatures, type GuideCat } from "@/lib/feature-guide";
import { Icon } from "@/components/kit";
import { Inline } from "@/components/guide-text";
import { HelpBot } from "@/components/help-bot";

export function GuideBrowser({ ids }: { ids: string[] }) {
  const mine = useMemo(() => FEATURES.filter((f) => ids.includes(f.id)), [ids]);
  const [cat, setCat] = useState<GuideCat | "All">("All");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  // /guide#feature-id opens that feature (links from the help bot).
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id || !mine.some((f) => f.id === id)) return;
      setCat("All"); setQ(""); setOpen(id);
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [mine]);

  const cats = GUIDE_CATS.filter((c) => mine.some((f) => f.cat === c));
  const shown = q.trim() ? searchFeatures(mine, q, 50) : mine.filter((f) => cat === "All" || f.cat === cat);
  const groups = q.trim() ? [{ cat: null, items: shown }] : cats.filter((c) => cat === "All" || c === cat).map((c) => ({ cat: c, items: shown.filter((f) => f.cat === c) }));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0">
        <div className="card mb-4 p-3 md:p-4">
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search features: import, template, allocation, quotation…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {(["All", ...cats] as const).map((c) => (
              <button key={c} onClick={() => { setCat(c); setQ(""); }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${cat === c && !q ? "border-transparent bg-brand-600 text-white shadow" : "border-slate-200 bg-white text-navy-900 hover:bg-slate-50"}`}>
                <Icon name={c === "All" ? "grid" : CAT_ICON[c]} className="h-3.5 w-3.5" />{c === "All" ? `All features (${mine.length})` : c}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 && <p className="card p-8 text-center text-sm text-slate-500">No feature matches “{q}”. Try Ask AI on the right.</p>}
        <div className="space-y-6">
          {groups.filter((g) => g.items.length).map((g) => (
            <section key={g.cat ?? "results"}>
              {g.cat && <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500"><Icon name={CAT_ICON[g.cat]} className="h-4 w-4" />{g.cat}</h2>}
              <div className="space-y-2">
                {g.items.map((f) => {
                  const isOpen = open === f.id;
                  return (
                    <div key={f.id} id={f.id} className="scroll-mt-20 rounded-xl border border-slate-200 bg-white">
                      <button className="flex w-full items-start gap-3 p-3 text-left md:p-4" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.id)}>
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={f.icon} className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-900">
                            {f.title}
                            <span className="badge bg-violet-50 text-violet-700">{f.steps.length} steps</span>
                            {f.access === "admin" && <span className="badge bg-amber-50 text-amber-800">Admin</span>}
                            {f.access === "super" && <span className="badge bg-slate-100 text-slate-700">Super Admin</span>}
                          </span>
                          <span className={`mt-0.5 block text-xs text-slate-500 ${isOpen ? "" : "line-clamp-2"}`}>{f.what}</span>
                        </span>
                        <Icon name={isOpen ? "chevronDown" : "chevronRight"} className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                      {isOpen && (
                        <div className="border-t border-slate-100 px-3 pb-4 pt-3 text-sm md:px-4">
                          <ol className="space-y-2">
                            {f.steps.map((s, i) => (
                              <li key={i} className="flex gap-3">
                                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{i + 1}</span>
                                <span className="pt-0.5 text-slate-700"><Inline text={s} /></span>
                              </li>
                            ))}
                          </ol>
                          {f.tips?.length ? (
                            <div className="mt-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                              {f.tips.map((t, i) => <p key={i}><b>Tip:</b> <Inline text={t} /></p>)}
                            </div>
                          ) : null}
                          <Link href={f.href} className="btn-primary mt-3 inline-flex items-center gap-1">Open {f.title.split(/[(:]/)[0].trim()} <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <aside className="order-first lg:order-last lg:sticky lg:top-20 lg:self-start">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-brand-600 text-white"><Icon name="bot" className="h-5 w-5" /></span>
            <div>
              <h2 className="text-sm font-semibold text-navy-900">Ask AI</h2>
              <p className="text-xs text-slate-500">CRM ke bare me kuch bhi poochho, step by step guide milega.</p>
            </div>
          </div>
          <HelpBot />
        </div>
      </aside>
    </div>
  );
}
