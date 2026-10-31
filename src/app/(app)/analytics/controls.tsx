"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/kit";

function useSetParams() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) if (v === null || v === "") q.delete(k); else q.set(k, v);
    start(() => router.push(`${path}?${q.toString()}`, { scroll: false }));
  };
  return { set, pending, refresh: () => start(() => router.refresh()) };
}

/** A select that writes its value into one URL param. */
export function ParamSelect({ param, value, options, icon, label }: { param: string; value: string; options: { value: string; label: string }[]; icon?: string; label: string }) {
  const { set, pending } = useSetParams();
  return (
    <label className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-900 shadow-sm ${pending ? "opacity-60" : ""}`}>
      {icon && <Icon name={icon} className="h-3.5 w-3.5 text-brand-600" />}
      <span className="sr-only">{label}</span>
      <select aria-label={label} className="cursor-pointer bg-transparent pr-1 outline-none" value={value} onChange={(e) => set({ [param]: e.target.value })}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Date range preset select; "Custom Range" opens two date inputs. */
export function RangePicker({ value, from, to, options }: { value: string; from: string; to: string; options: { value: string; label: string }[] }) {
  const { set, pending } = useSetParams();
  const [custom, setCustom] = useState(value === "custom");
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 ${pending ? "opacity-60" : ""}`}>
      <label className="inline-flex items-center gap-1.5 rounded-lg border border-brand-100 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 shadow-sm">
        <Icon name="calendar" className="h-3.5 w-3.5" />
        <select aria-label="Date range" className="cursor-pointer bg-transparent pr-1 outline-none" value={custom ? "custom" : value}
          onChange={(e) => { if (e.target.value === "custom") setCustom(true); else { setCustom(false); set({ range: e.target.value, from: null, to: null }); } }}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {custom && (
        <span className="inline-flex items-center gap-1 text-xs">
          <input type="date" className="input h-8 w-[8.5rem] py-1 text-xs" value={f} max={t} onChange={(e) => setF(e.target.value)} aria-label="From date" />
          <span className="text-slate-400">to</span>
          <input type="date" className="input h-8 w-[8.5rem] py-1 text-xs" value={t} min={f} onChange={(e) => setT(e.target.value)} aria-label="To date" />
          <button type="button" className="btn-primary btn-sm" onClick={() => set({ range: "custom", from: f, to: t })}>Apply</button>
        </span>
      )}
    </div>
  );
}

export function RefreshButton() {
  const { refresh, pending } = useSetParams();
  return (
    <button type="button" onClick={refresh} title="Refresh" aria-label="Refresh" className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white shadow-sm hover:bg-brand-700">
      <Icon name="refresh" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
    </button>
  );
}

/** Multi-select dropdown (checkboxes) that writes a comma list into one URL param. */
export function MultiPick({ param, selected, options, placeholder }: { param: string; selected: string[]; options: { value: string; label: string }[]; placeholder: string }) {
  const { set, pending } = useSetParams();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const text = sel.length ? options.filter((o) => sel.includes(o.value)).map((o) => o.label).join(", ") : placeholder;
  return (
    <div ref={ref} className={`relative ${pending ? "opacity-60" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-64 max-w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-semibold uppercase text-navy-900 shadow-sm">
        <span className="truncate">{text}</span><Icon name="chevronDown" className="h-3.5 w-3.5 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={sel.includes(o.value)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, o.value] : s.filter((v) => v !== o.value)))} />
              {o.label}
            </label>
          ))}
          <div className="sticky bottom-0 flex justify-between gap-2 border-t border-slate-100 bg-white p-1.5">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSel([])}>Clear</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => { setOpen(false); set({ [param]: sel.join(",") || null }); }}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
