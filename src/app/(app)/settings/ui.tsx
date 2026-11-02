"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { SWATCHES } from "@/lib/settings-shared";
import { reorderMaster } from "@/lib/actions/settings";

/** Grey header bar with title, search box and buttons (like the reference Settings screens). */
export function ListCard({ title, q, setQ, actions, footer, children }: {
  title: string; q?: string; setQ?: (v: string) => void; actions?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        {setQ && (
          <label className="relative min-w-40 flex-1 sm:mx-auto sm:max-w-xs">
            <span className="sr-only">Search</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <div className="overflow-x-auto">{children}</div>
      {footer && <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-navy-900">{footer}</div>}
    </section>
  );
}

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn-primary h-9 w-9 justify-center px-0" title="Refresh" aria-label="Refresh" onClick={() => start(() => router.refresh())}>
      <Icon name="refresh" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
    </button>
  );
}

export function ColorChip({ color }: { color?: string | null }) {
  if (!color) return <span className="text-slate-400">—</span>;
  return <span className="inline-flex items-center gap-2 font-mono text-xs uppercase"><span className="h-3.5 w-3.5 rounded border border-black/10" style={{ background: color }} />{color}</span>;
}

/** Colour picker: preset swatches + native picker + hex box. Submits as `name`. */
export function ColorInput({ name = "color", defaultValue }: { name?: string; defaultValue?: string | null }) {
  const [c, setC] = useState((defaultValue || SWATCHES[2]).toUpperCase());
  const valid = /^#[0-9A-F]{6}$/.test(c);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((s) => (
          <button key={s} type="button" title={s} aria-label={`Colour ${s}`} onClick={() => setC(s)}
            className={`h-6 w-6 rounded-full border ${c === s ? "ring-2 ring-brand-600 ring-offset-1" : "border-black/10"}`} style={{ background: s }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={valid ? c : "#000000"} onChange={(e) => setC(e.target.value.toUpperCase())} className="h-9 w-12 cursor-pointer rounded border" aria-label="Pick colour" />
        <input className="input max-w-32 font-mono uppercase" name={name} value={c} onChange={(e) => setC(e.target.value.toUpperCase())} maxLength={7} pattern="#[0-9A-Fa-f]{6}" required />
      </div>
    </div>
  );
}

/**
 * Drag-and-drop ordering (plus ↑/↓ buttons for touch). Saves the new
 * sequence right after a drop. Returns the rows in display order.
 */
export function useOrder<T extends { id: string }>(rows: T[], kind: "statuses" | "sources" | "fields") {
  const [order, setOrder] = useState(rows.map((r) => r.id));
  const [drag, setDrag] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [saving, start] = useTransition();
  const router = useRouter();
  const key = rows.map((r) => r.id).join();
  useEffect(() => { setOrder(key ? key.split(",") : []); }, [key]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sorted = order.map((id) => byId.get(id)).filter(Boolean) as T[];

  const save = (ids: string[]) => {
    setOrder(ids);
    start(async () => {
      const r = await reorderMaster(kind, ids);
      setErr(r?.error ?? "");
      router.refresh();
    });
  };
  const move = (id: string, to: number) => {
    const ids = order.filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    save(ids);
  };
  const rowProps = (id: string, enabled = true) => enabled ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setDrag(id); e.dataTransfer.effectAllowed = "move"; },
    onDragOver: (e: React.DragEvent) => { if (drag && drag !== id) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (drag && drag !== id) move(drag, order.indexOf(id)); setDrag(null); },
    onDragEnd: () => setDrag(null),
    className: drag === id ? "opacity-40" : "",
  } : {};
  return { sorted, rowProps, move, index: (id: string) => order.indexOf(id), saving, err };
}

export function DragCell({ i, n, onMove }: { i: number; n: number; onMove: (to: number) => void }) {
  return (
    <td className="td w-16 whitespace-nowrap text-slate-400">
      <span className="cursor-grab select-none px-1 text-base leading-none max-sm:hidden" title="Drag to reorder" aria-hidden>⠿</span>
      <button type="button" className="px-0.5 hover:text-navy-900 disabled:opacity-30 sm:hidden" disabled={i === 0} onClick={() => onMove(i - 1)} aria-label="Move up">↑</button>
      <button type="button" className="px-0.5 hover:text-navy-900 disabled:opacity-30 sm:hidden" disabled={i === n - 1} onClick={() => onMove(i + 1)} aria-label="Move down">↓</button>
    </td>
  );
}

export function IconAction({ icon, label, onClick, tone = "blue" }: { icon: string; label: string; onClick: () => void; tone?: "blue" | "red" }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={`grid h-7 w-7 place-items-center rounded-full text-white ${tone === "red" ? "bg-red-500 hover:bg-red-600" : "bg-indigo-600 hover:bg-indigo-700"}`}>
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

export const match = (q: string, ...vals: (string | null | undefined)[]) => {
  const t = q.trim().toLowerCase();
  return !t || vals.some((v) => (v ?? "").toLowerCase().includes(t));
};

/** Run a server action from a button with confirm + a shared error line. */
export function useAct() {
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ error?: string; ok?: string } | undefined>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    start(async () => { const r = await fn(); setMsg(r ?? {}); if (!r?.error) router.refresh(); });
  };
  const banner = (msg.error || msg.ok) ? (
    <div role={msg.error ? "alert" : "status"} className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${msg.error ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>
      <span>{msg.error ?? msg.ok}</span><button type="button" onClick={() => setMsg({})} aria-label="Dismiss">✕</button>
    </div>
  ) : null;
  return { run, pending, banner };
}
