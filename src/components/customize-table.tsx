"use client";
import { useMemo, useState, useTransition } from "react";
import { Modal } from "@/components/ui";

// "Customize Table" modal shared by list pages (leads, tasks): tick columns to show,
// move them with the arrows, Save / Reset. The caller owns the column master and
// how the layout is stored.

export type ColItem = { k: string; on: boolean };
type Item = ColItem;

/** Saved order first (unknown keys dropped), then any column added since the save. */
export function mergeLayout(saved: { cols?: ColItem[] } | null | undefined, defaults: ColItem[]): ColItem[] {
  if (!saved?.cols?.length) return defaults;
  const known = new Set(defaults.map((d) => d.k));
  const seen = new Set<string>();
  const out: ColItem[] = [];
  for (const c of saved.cols) if (known.has(c.k) && !seen.has(c.k)) { seen.add(c.k); out.push({ k: c.k, on: !!c.on }); }
  for (const d of defaults) if (!seen.has(d.k)) out.push(d);
  return out;
}

export function CustomizeTable({ labels, initial, defaults, first, save: persist, onClose, onSaved }: {
  labels: Map<string, string>; initial: Item[]; defaults: Item[]; first: string;
  save: (layout: { v: 1; cols: Item[] } | null) => Promise<{ error?: string }>; onClose: () => void; onSaved: (l: Item[]) => void;
}) {
  const [items, setItems] = useState<Item[]>(initial);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const shown = useMemo(() => items.filter((i) => labels.get(i.k)!.toLowerCase().includes(q.trim().toLowerCase())), [items, q, labels]);
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
    const r = await persist(reset ? null : { v: 1, cols: next });
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
            <input type="checkbox" checked disabled className="h-4 w-4" /> {first} <span className="ml-auto text-xs">always first</span>
          </div>
          {shown.map((i) => (
            <div key={i.k} onClick={() => setCur(i.k)}
              className={`flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 ${cur === i.k ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-slate-50"}`}>
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={i.on} onChange={() => flip(i.k)} onClick={(e) => e.stopPropagation()} aria-label={`Show ${labels.get(i.k)!}`} />
              <span className={i.on ? "text-navy-900" : "text-slate-500"}>{labels.get(i.k)!}</span>
            </div>
          ))}
          {shown.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">No column matches “{q}”.</div>}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Tick to show a column. Click a row, then use the arrows to move it. {count} of {items.length} columns shown. Saved to your login, so it follows you on every device.</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button type="button" className="btn-ghost" disabled={saving} onClick={() => { setItems(defaults); save(defaults, true); }}>Reset</button>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => save(items)}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
