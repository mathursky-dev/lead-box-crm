"use client";

import Link from "next/link";
import { useState } from "react";

// Hand-drawn SVG charts for /analytics (no chart library in this app).
// Colours come from the caller and follow the entity (status, source, activity type), never its rank.

export type Slice = { key: string; label: string; value: number; color: string; href?: string; sub?: string };

const nf = new Intl.NumberFormat("en-IN");
const pctOf = (v: number, total: number) => (total ? `${(v / total * 100).toFixed(v / total < 0.1 ? 1 : 0)}%` : "0%");

function Tip({ x, y, children }: { x: string; y: number; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute z-20 min-w-[140px] -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg" style={{ left: x, top: y - 8 }}>
      {children}
    </div>
  );
}

/** Legend table beside funnel/donut: dot, name, count, share. Rows link to the lead list when href is set. */
export function SliceLegend({ rows, total, format = (v: number) => nf.format(v), active, onHover }: { rows: Slice[]; total: number; format?: (v: number) => string; active?: string | null; onHover?: (k: string | null) => void }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r) => {
          const name = <span className="flex min-w-0 items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} /><span className="truncate" title={r.label}>{r.label}</span></span>;
          return (
            <tr key={r.key} onMouseEnter={() => onHover?.(r.key)} onMouseLeave={() => onHover?.(null)} className={`transition ${active && active !== r.key ? "opacity-40" : ""}`}>
              <td className="max-w-[150px] py-1 pr-2 text-slate-700">{r.href ? <Link href={r.href} className="hover:text-brand-700 hover:underline">{name}</Link> : name}</td>
              <td className="py-1 pr-2 text-right font-semibold text-navy-900 tabular-nums">{format(r.value)}</td>
              <td className="w-12 py-1 text-right text-slate-500 tabular-nums">{pctOf(r.value, total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Stacked funnel: one band per slice, band height ~ value, narrowing to the bottom. */
export function Funnel({ rows, format = (v: number) => nf.format(v) }: { rows: Slice[]; format?: (v: number) => string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = rows.reduce((n, r) => n + r.value, 0);
  const W = 260, H = 260, GAP = 2, MIN = 7;
  const shown = rows.filter((r) => r.value > 0);
  const free = H - GAP * Math.max(0, shown.length - 1) - MIN * shown.length;
  const bands: { r: Slice; y: number; h: number }[] = [];
  for (const r of shown) {
    const prev = bands[bands.length - 1];
    bands.push({ r, y: prev ? prev.y + prev.h + GAP : 0, h: MIN + (total ? (r.value / total) * Math.max(0, free) : 0) });
  }
  const half = (yy: number) => (W / 2) * (1 - 0.62 * (yy / H)); // half-width at depth yy
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,280px)_1fr]">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[280px]" role="img" aria-label="Funnel">
        {bands.map(({ r, y: y0, h }) => {
          const y1 = y0 + h, a = half(y0), b = half(y1);
          const pts = `${W / 2 - a},${y0} ${W / 2 + a},${y0} ${W / 2 + b},${y1} ${W / 2 - b},${y1}`;
          return (
            <g key={r.key} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} className="cursor-default">
              <polygon points={pts} fill={r.color} opacity={hover && hover !== r.key ? 0.35 : 1} style={{ transition: "opacity .15s" }}>
                <title>{`${r.label}: ${format(r.value)} (${pctOf(r.value, total)})`}</title>
              </polygon>
              {h >= 18 && <text x={W / 2} y={y0 + h / 2 + 4} textAnchor="middle" className="pointer-events-none fill-white text-[12px] font-semibold" style={{ paintOrder: "stroke", stroke: "rgba(15,23,42,.35)", strokeWidth: 2 }}>{format(r.value)}</text>}
            </g>
          );
        })}
      </svg>
      <SliceLegend rows={rows} total={total} format={format} active={hover} onHover={setHover} />
    </div>
  );
}

/** Horizontal bars, an alternative view for funnel / source data. */
export function HBars({ rows, format = (v: number) => nf.format(v) }: { rows: Slice[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const label = <span className="truncate" title={r.label}>{r.label}</span>;
        return (
          <div key={r.key} className="grid grid-cols-[minmax(80px,140px)_1fr_auto] items-center gap-2 text-xs" title={`${r.label}: ${format(r.value)} (${pctOf(r.value, total)})`}>
            <span className="flex min-w-0 text-slate-700">{r.href ? <Link href={r.href} className="truncate hover:text-brand-700 hover:underline">{label}</Link> : label}</span>
            <span className="h-3.5 rounded-r bg-slate-100"><span className="block h-full rounded-r" style={{ width: `${Math.max(r.value ? 2 : 0, (r.value / max) * 100)}%`, background: r.color }} /></span>
            <span className="w-24 text-right tabular-nums"><b className="text-navy-900">{format(r.value)}</b> <span className="text-slate-500">{pctOf(r.value, total)}</span></span>
          </div>
        );
      })}
    </div>
  );
}

/** Donut with the total in the middle and a legend table. */
export function Donut({ rows, center, centerSub }: { rows: Slice[]; center: string; centerSub: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = rows.reduce((n, r) => n + r.value, 0);
  const R = 80, r0 = 50, C = 100;
  const pt = (ang: number, rad: number) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
  const shown = rows.filter((r) => r.value > 0);
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,220px)_1fr]">
      <svg viewBox="0 0 200 200" className="mx-auto w-full max-w-[220px]" role="img" aria-label="Donut chart">
        {shown.length === 1 && <circle cx={C} cy={C} r={(R + r0) / 2} fill="none" stroke={shown[0].color} strokeWidth={R - r0}><title>{`${shown[0].label}: ${nf.format(shown[0].value)} (100%)`}</title></circle>}
        {shown.length > 1 && shown.map((s, i) => {
          const before = shown.slice(0, i).reduce((n, x) => n + x.value, 0);
          const sweep = (s.value / total) * Math.PI * 2;
          const a0 = -Math.PI / 2 + (before / total) * Math.PI * 2, a1 = a0 + sweep;
          const large = sweep > Math.PI ? 1 : 0;
          const d = `M${pt(a0, R)} A${R},${R} 0 ${large} 1 ${pt(a1, R)} L${pt(a1, r0)} A${r0},${r0} 0 ${large} 0 ${pt(a0, r0)}Z`;
          return (
            <path key={s.key} d={d} fill={s.color} stroke="#fff" strokeWidth={2} opacity={hover && hover !== s.key ? 0.35 : 1} style={{ transition: "opacity .15s" }}
              onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
              <title>{`${s.label}: ${nf.format(s.value)} (${pctOf(s.value, total)})`}</title>
            </path>
          );
        })}
        <text x={C} y={C + 2} textAnchor="middle" className="fill-navy-900 text-[22px] font-bold">{center}</text>
        <text x={C} y={C + 20} textAnchor="middle" className="fill-slate-500 text-[11px]">{centerSub}</text>
      </svg>
      <SliceLegend rows={rows} total={total} active={hover} onHover={setHover} />
    </div>
  );
}

export type Series = { key: string; name: string; color: string; values: number[] };

// Monotone cubic interpolation (no overshoot below zero between points).
function smoothPath(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n === 0) return "";
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const dx = xs.map((x, i) => (i < n - 1 ? xs[i + 1] - x : 0));
  const m = ys.map((y, i) => (i < n - 1 ? (ys[i + 1] - y) / dx[i] : 0));
  const t = ys.map((_, i) => {
    if (i === 0) return m[0];
    if (i === n - 1) return m[n - 2];
    return m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${xs[i] + h},${ys[i] + t[i] * h} ${xs[i + 1] - h},${ys[i + 1] - t[i + 1] * h} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return d;
}

const niceMax = (v: number) => {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
};

/** Daily trend, one line per series (area or line), with a hover crosshair + tooltip. */
export function Trend({ labels, series, mode = "area", height = 240 }: { labels: string[]; series: Series[]; mode?: "area" | "line" | "bar"; height?: number }) {
  const [idx, setIdx] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const vis = series.filter((s) => !hidden.has(s.key));
  const W = 720, H = height, L = 34, R = 24, T = 10, B = 38;
  const n = labels.length;
  const stackTotals = labels.map((_, i) => vis.reduce((sum, s) => sum + s.values[i], 0));
  const max = niceMax(Math.max(1, ...(mode === "bar" ? stackTotals : vis.flatMap((s) => s.values))));
  const x = (i: number) => (n <= 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const slot = (W - L - R) / Math.max(1, n);
  const xb = (i: number) => L + slot * i + slot / 2;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(max * k));
  const every = Math.max(1, Math.ceil(n / 12));
  const px = (i: number) => (mode === "bar" ? xb(i) : x(i));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const i = mode === "bar" ? Math.floor((sx - L) / slot) : Math.round(((sx - L) / (W - L - R)) * (n - 1));
    setIdx(Math.min(n - 1, Math.max(0, n <= 1 ? 0 : i)));
  };
  const tipX = idx === null ? "0" : `${Math.min(85, Math.max(15, (px(idx) / W) * 100))}%`;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trend chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={t ? "3 3" : undefined} />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[11px]">{t}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 || i === n - 1) && (
            <text key={i} x={px(i)} y={H - B + 14} textAnchor={n > 14 ? "end" : "middle"} transform={n > 14 ? `rotate(-35 ${px(i)} ${H - B + 14})` : undefined} className="fill-slate-500 text-[11px]">{l}</text>
          ))}
          {mode === "bar" ? labels.map((_, i) => {
            let acc = 0;
            const w = Math.max(2, Math.min(28, slot * 0.6));
            return (
              <g key={i}>
                {vis.map((s) => {
                  const v = s.values[i];
                  if (!v) return null;
                  const y0 = y(acc + v), h = y(acc) - y(acc + v);
                  acc += v;
                  return <rect key={s.key} x={xb(i) - w / 2} y={y0} width={w} height={Math.max(1, h - 1)} rx={2} fill={s.color} opacity={idx !== null && idx !== i ? 0.55 : 1} />;
                })}
              </g>
            );
          }) : vis.map((s) => {
            const xs = labels.map((_, i) => x(i)), ys = s.values.map(y);
            const line = smoothPath(xs, ys);
            return (
              <g key={s.key}>
                {mode === "area" && n > 1 && <path d={`${line} L${xs[n - 1]},${y(0)} L${xs[0]},${y(0)}Z`} fill={s.color} opacity={0.12} />}
                <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                {n <= 1 && <circle cx={xs[0]} cy={ys[0]} r={4} fill={s.color} />}
              </g>
            );
          })}
          {idx !== null && mode !== "bar" && (
            <g>
              <line x1={x(idx)} x2={x(idx)} y1={T} y2={H - B} stroke="#94a3b8" strokeDasharray="3 3" />
              {vis.map((s) => <circle key={s.key} cx={x(idx)} cy={y(s.values[idx])} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />)}
            </g>
          )}
          <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setIdx(null)} />
        </svg>
        {idx !== null && (
          <Tip x={tipX} y={0}>
            <div className="mb-1 font-semibold text-navy-900">{labels[idx]} · {nf.format(stackTotals[idx])}</div>
            {vis.filter((s) => s.values[idx]).sort((a, b) => b.values[idx] - a.values[idx]).slice(0, 8).map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3 text-slate-600"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span><b className="text-navy-900">{s.values[idx]}</b></div>
            ))}
            {!stackTotals[idx] && <div className="text-slate-400">Nothing this day</div>}
          </Tip>
        )}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button key={s.key} type="button" onClick={() => setHidden((h) => { const c = new Set(h); if (c.has(s.key)) c.delete(s.key); else c.add(s.key); return c; })}
              className={`flex items-center gap-1.5 ${off ? "text-slate-400 line-through" : "text-slate-700"}`} title={off ? "Show" : "Hide"}>
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: off ? "#cbd5e1" : s.color }} />{s.name} ({nf.format(s.values.reduce((a, b) => a + b, 0))})
            </button>
          );
        })}
      </div>
    </div>
  );
}
