"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { Modal } from "@/components/ui";
import { useT } from "@/components/lang";
import { runReport, saveReport, deleteReport } from "@/lib/actions/report-builder";
import { DIMS, MEASURES, DATE_FIELDS, CHARTS, DEFAULT_SPEC, type Dim, type Measure, type ReportSpec, type ReportResult } from "@/lib/report-spec";
import { PERIODS } from "@/lib/periods";
import { downloadXlsx, type Cell } from "@/lib/xlsx";

export type Saved = { id: string; name: string; spec: ReportSpec; is_shared: boolean; updated_at: string; mine: boolean };
type O = { id: string; name: string };
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948", "#0891b2", "#a16207"];
const TIME = new Set<Dim>(["day", "week", "month"]);
const MONEY = new Set<Measure>(["expected_value", "won_value", "avg_won_value"]);
const fmt = (m: Measure, v: number | undefined) => v === undefined ? "—" : m === "win_rate" ? `${v}%` : MONEY.has(m) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : v.toLocaleString("en-IN");

export function Builder({ saved, savedReady, initialId, canShare, opts }: {
  saved: Saved[]; savedReady: boolean; initialId: string | null; canShare: boolean; opts: { statuses: O[]; sources: O[]; owners: O[]; products: O[] };
}) {
  const t = useT();
  const router = useRouter();
  const first = saved.find((s) => s.id === initialId) ?? null;
  const [spec, setSpec] = useState<ReportSpec>(first?.spec ?? DEFAULT_SPEC);
  const [current, setCurrent] = useState<Saved | null>(first);
  const [res, setRes] = useState<ReportResult | null>(null);
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const set = <K extends keyof ReportSpec>(k: K, v: ReportSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));

  // Re-run shortly after every change.
  const key = JSON.stringify(spec);
  useEffect(() => {
    const h = setTimeout(() => start(async () => setRes(await runReport(JSON.parse(key) as ReportSpec))), 350);
    return () => clearTimeout(h);
  }, [key]);
  useEffect(() => { if (note) { const h = setTimeout(() => setNote(null), 3500); return () => clearTimeout(h); } }, [note]);

  // With a column split only the first chosen number is shown per cell.
  const measures = spec.cols ? spec.measures.slice(0, 1) : spec.measures;
  const toggleMeasure = (m: Measure) => set("measures", spec.measures.includes(m) ? (spec.measures.length > 1 ? spec.measures.filter((x) => x !== m) : spec.measures) : [...spec.measures, m]);
  const filterCount = spec.status_ids.length + spec.source_ids.length + spec.owner_ids.length + spec.product_ids.length;

  const exportXlsx = () => {
    if (!res) return;
    const head: Cell[] = [t(DIMS[spec.rows])];
    const body: Cell[][] = [];
    if (spec.cols) {
      const m = measures[0];
      head.push(...res.colKeys.map((c) => c.label), `${t("Total")} · ${MEASURES[m]}`);
      for (const r of res.rowKeys) body.push([r.label, ...res.colKeys.map((c) => res.cells[r.key]?.[c.key]?.[m] ?? 0), res.cells[r.key]?._?.[m] ?? 0]);
      body.push([t("Total"), ...res.colKeys.map((c) => res.rowKeys.reduce((a, r) => a + (m === "win_rate" || m === "avg_won_value" ? 0 : res.cells[r.key]?.[c.key]?.[m] ?? 0), 0) || null), res.totals[m] ?? 0]);
    } else {
      head.push(...measures.map((m) => MEASURES[m]));
      for (const r of res.rowKeys) body.push([r.label, ...measures.map((m) => res.cells[r.key]?._?.[m] ?? 0)]);
      body.push([t("Total"), ...measures.map((m) => res.totals[m] ?? 0)]);
    }
    const about: Cell[][] = [["Report", current?.name ?? "Custom report"], ["Rows", DIMS[spec.rows]], ["Columns", spec.cols ? DIMS[spec.cols] : "—"],
      ["Date", DATE_FIELDS[spec.date]], ["From", res.from], ["To", res.to], ["Leads counted", res.total], ["Downloaded", new Date().toLocaleString("en-IN")]];
    downloadXlsx(`${(current?.name ?? "lead-report").replace(/[^\w\- ]+/g, "").trim() || "lead-report"} ${res.from} to ${res.to}`,
      [{ name: "Report", rows: [head, ...body] }, { name: "About", rows: [["Setting", "Value"], ...about] }]);
  };

  const doSave = async (name: string, shared: boolean, asNew: boolean) => {
    setSaving(true);
    const r = await saveReport(name, spec, shared, asNew ? null : current?.id ?? null);
    setSaving(false);
    if (r.error) { setNote({ text: r.error, bad: true }); return false; }
    setNote({ text: r.ok ?? "Saved." });
    setCurrent({ id: r.id!, name, spec, is_shared: shared, updated_at: new Date().toISOString(), mine: true });
    router.replace(`/report-builder?r=${r.id}`);
    router.refresh();
    return true;
  };
  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* saved reports */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Icon name="files" className="h-4 w-4 text-slate-400" />
        <select className="input h-9 min-w-0 flex-1 sm:max-w-xs" value={current?.id ?? ""} aria-label="Saved reports" disabled={!savedReady}
          onChange={(e) => {
            const s = saved.find((x) => x.id === e.target.value) ?? null;
            setCurrent(s); setSpec(s?.spec ?? DEFAULT_SPEC);
            router.replace(s ? `/report-builder?r=${s.id}` : "/report-builder");
          }}>
          <option value="">{savedReady ? `New report${saved.length ? ` · ${saved.length} saved` : ""}` : "Saving needs the latest database update"}</option>
          {saved.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_shared ? " (shared)" : ""}{!s.mine ? " · by team" : ""}</option>)}
        </select>
        <button type="button" className="btn-ghost h-9" disabled={!savedReady} onClick={() => setSaveOpen(true)}><Icon name="check" className="h-4 w-4" />{current?.mine ? "Save" : "Save report"}</button>
        {current?.mine && (
          <button type="button" className="btn-ghost h-9 text-red-600" onClick={async () => {
            if (!window.confirm(`Delete the saved report "${current.name}"?`)) return;
            const r = await deleteReport(current.id);
            setNote(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Deleted." });
            if (!r.error) { setCurrent(null); router.replace("/report-builder"); router.refresh(); }
          }}><Icon name="trash" className="h-4 w-4" /><span className="max-sm:hidden">Delete</span></button>
        )}
        <button type="button" className="btn-primary h-9 sm:ml-auto" onClick={exportXlsx} disabled={!res || !!res.error || !res.total}><Icon name="download" className="h-4 w-4" />Excel</button>
      </div>

      {/* controls */}
      <div className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Sel label={t("Group by")} value={spec.rows} onChange={(v) => set("rows", v as Dim)} options={DIMS} />
        <Sel label="Split into columns" value={spec.cols} onChange={(v) => set("cols", v as Dim | "")} options={{ "": "— None —", ...DIMS }} />
        <Sel label={t("Date based on")} value={spec.date} onChange={(v) => set("date", v as ReportSpec["date"])} options={DATE_FIELDS} />
        <div>
          <span className="label">{t("Period")}</span>
          <select className="input" value={spec.preset} onChange={(e) => set("preset", e.target.value)}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {spec.preset === "custom" && (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <input type="date" className="input" aria-label="From" value={spec.from ?? ""} onChange={(e) => set("from", e.target.value)} />
              <input type="date" className="input" aria-label="To" value={spec.to ?? ""} onChange={(e) => set("to", e.target.value)} />
            </div>
          )}
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <span className="label">{t("Show")}{spec.cols ? " (with a column split, the first ticked number is shown)" : ""}</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MEASURES) as Measure[]).map((m) => {
              const on = spec.measures.includes(m);
              return (
                <button key={m} type="button" onClick={() => toggleMeasure(m)} aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-transparent bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {MEASURES[m]}
                </button>
              );
            })}
          </div>
        </div>
        <Sel label={t("Chart")} value={spec.chart} onChange={(v) => set("chart", v as ReportSpec["chart"])} options={CHARTS} />
        <div className="flex flex-wrap items-end gap-1.5 sm:col-span-2 lg:col-span-4">
          <span className="label w-full">{t("Filters")}{filterCount ? ` · ${filterCount}` : ""}</span>
          <Multi label="Status" all={opts.statuses} value={spec.status_ids} onChange={(v) => set("status_ids", v)} />
          <Multi label="Source" all={opts.sources} value={spec.source_ids} onChange={(v) => set("source_ids", v)} />
          <Multi label="Owner" all={opts.owners} value={spec.owner_ids} onChange={(v) => set("owner_ids", v)} />
          <Multi label="Product" all={opts.products} value={spec.product_ids} onChange={(v) => set("product_ids", v)} />
          {filterCount > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setSpec((s) => ({ ...s, status_ids: [], source_ids: [], owner_ids: [], product_ids: [] }))}>Clear filters</button>}
        </div>
      </div>

      {/* result */}
      <div className={`transition ${pending ? "opacity-60" : ""}`}>
        {!res ? <div className="card p-8 text-center text-sm text-slate-500">Loading…</div>
          : res.error ? <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{res.error}</div>
          : !res.total ? <div className="card p-8 text-center text-sm text-slate-500">{t("No data for these filters")}</div>
          : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                <b className="text-navy-900">{res.total.toLocaleString("en-IN")}</b> leads · {DATE_FIELDS[spec.date]} {res.from.split("-").reverse().join("/")} – {res.to.split("-").reverse().join("/")} (IST)
                {res.truncated && <span className="text-amber-700"> · only the first 20,000 leads are counted; pick a shorter period</span>}
              </p>
              {spec.chart !== "none" && <Chart res={res} spec={spec} measure={measures[0]} />}
              <ResultTable res={res} spec={spec} measures={measures} />
            </div>
          )}
      </div>

      <SaveDialog open={saveOpen} onClose={() => setSaveOpen(false)} current={current} canShare={canShare} saving={saving}
        onSave={async (n, sh, asNew) => { if (await doSave(n, sh, asNew)) setSaveOpen(false); }} />
      {note && <div role="status" className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${note.bad ? "bg-red-700" : "bg-navy-900"}`}>{note.text}</div>}
    </div>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Record<string, string> }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}

function Multi({ label, all, value, onChange }: { label: string; all: O[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = all.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative">
      <button type="button" className={`btn-ghost btn-sm ${value.length ? "border-brand-200 bg-brand-50 text-brand-700" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}{value.length ? ` (${value.length})` : ""} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 w-64 max-w-[80vw] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            {all.length > 8 && <input className="input mb-1.5 h-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
            <div className="max-h-60 overflow-y-auto">
              {list.map((o) => (
                <label key={o.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={value.includes(o.id)} onChange={() => onChange(value.includes(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id])} />
                  <span className="truncate">{o.name}</span>
                </label>
              ))}
              {!list.length && <p className="px-1.5 py-1 text-xs text-slate-500">Nothing to pick</p>}
            </div>
            {value.length > 0 && <button type="button" className="mt-1 text-xs font-semibold text-brand-700" onClick={() => onChange([])}>Clear</button>}
          </div>
        </>
      )}
    </div>
  );
}

function ResultTable({ res, spec, measures }: { res: ReportResult; spec: ReportSpec; measures: Measure[] }) {
  const t = useT();
  const m0 = measures[0];
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th sticky left-0 bg-slate-50">{t(DIMS[spec.rows])}</th>
            {spec.cols ? <>{res.colKeys.map((c) => <th key={c.key} className="th whitespace-nowrap text-right">{c.label}</th>)}<th className="th text-right">{t("Total")}</th></>
              : measures.map((m) => <th key={m} className="th whitespace-nowrap text-right">{MEASURES[m]}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y">
          {res.rowKeys.map((r) => (
            <tr key={r.key} className="hover:bg-slate-50">
              <td className="td sticky left-0 bg-white font-medium text-navy-900">{r.label}</td>
              {spec.cols ? <>{res.colKeys.map((c) => <td key={c.key} className="td text-right tabular-nums">{fmt(m0, res.cells[r.key]?.[c.key]?.[m0])}</td>)}<td className="td text-right font-semibold tabular-nums">{fmt(m0, res.cells[r.key]?._?.[m0])}</td></>
                : measures.map((m) => <td key={m} className="td text-right tabular-nums">{fmt(m, res.cells[r.key]?._?.[m])}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
          <tr>
            <td className="td sticky left-0 bg-slate-50">{t("Total")}</td>
            {spec.cols ? <>{res.colKeys.map((c) => <td key={c.key} className="td text-right" />)}<td className="td text-right tabular-nums">{fmt(m0, res.totals[m0])}</td></>
              : measures.map((m) => <td key={m} className="td text-right tabular-nums">{fmt(m, res.totals[m])}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Small SVG charts: bar (stacked when split into columns), line, pie. First chosen number is charted. */
function Chart({ res, spec, measure }: { res: ReportResult; spec: ReportSpec; measure: Measure }) {
  const rows = TIME.has(spec.rows) ? res.rowKeys : res.rowKeys.slice(0, 15);
  const series = spec.cols ? res.colKeys.slice(0, 8) : [{ key: "_", label: MEASURES[measure] }];
  const stackable = !(measure === "win_rate" || measure === "avg_won_value");
  const val = (rk: string, ck: string) => Number(res.cells[rk]?.[ck]?.[measure] ?? 0);
  const data = useMemo(() => rows.map((r) => ({ label: r.label, vals: series.map((s) => val(r.key, s.key)) })), [res, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const legend = spec.cols && (
    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
      {series.map((s, i) => <span key={s.key} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{s.label}</span>)}
    </div>
  );

  if (spec.chart === "pie") {
    const pts = res.rowKeys.map((r) => ({ label: r.label, v: val(r.key, "_") })).filter((p) => p.v > 0);
    const top = pts.slice(0, 9);
    const rest = pts.slice(9).reduce((a, p) => a + p.v, 0);
    if (rest) top.push({ label: "Other", v: rest });
    const sum = top.reduce((a, p) => a + p.v, 0) || 1;
    const slices = top.reduce<{ label: string; v: number; a0: number; a1: number }[]>((acc, p) => {
      const a0 = acc.length ? acc[acc.length - 1].a1 : -Math.PI / 2;
      return [...acc, { ...p, a0, a1: a0 + (p.v / sum) * Math.PI * 2 }];
    }, []);
    return (
      <div className="card flex flex-col items-center gap-4 p-4 sm:flex-row">
        <svg viewBox="-1.05 -1.05 2.1 2.1" className="h-52 w-52 shrink-0" role="img" aria-label={`${MEASURES[measure]} pie chart`}>
          {slices.map(({ label, v, a0, a1 }, i) => {
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const d = slices.length === 1 ? "M 0 -1 A 1 1 0 1 1 -0.001 -1 Z" : `M 0 0 L ${Math.cos(a0)} ${Math.sin(a0)} A 1 1 0 ${large} 1 ${Math.cos(a1)} ${Math.sin(a1)} Z`;
            return <path key={label} d={d} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={0.02}><title>{`${label}: ${fmt(measure, v)}`}</title></path>;
          })}
          <circle r={0.55} fill="#fff" />
        </svg>
        <ul className="w-full space-y-1 text-sm">
          {top.map((p, i) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="flex-1 truncate">{p.label}</span><b className="tabular-nums">{fmt(measure, p.v)}</b>
              <span className="w-10 text-right text-xs text-slate-500">{Math.round((p.v / sum) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (spec.chart === "line") {
    const W = 640, H = 220, P = 28;
    const max = Math.max(1, ...data.flatMap((d) => d.vals));
    const x = (i: number) => P + (data.length < 2 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (data.length - 1));
    const y = (v: number) => H - P - (v / max) * (H - 2 * P);
    return (
      <div className="card p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label={`${MEASURES[measure]} line chart`} preserveAspectRatio="none">
          {[0, 0.5, 1].map((f) => <g key={f}><line x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" /><text x={2} y={y(max * f) + 4} fontSize="10" fill="#94a3b8">{Math.round(max * f)}</text></g>)}
          {series.map((s, si) => (
            <g key={s.key}>
              <polyline fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth={2} points={data.map((d, i) => `${x(i)},${y(d.vals[si])}`).join(" ")} />
              {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.vals[si])} r={3} fill={COLORS[si % COLORS.length]}><title>{`${d.label} · ${s.label}: ${fmt(measure, d.vals[si])}`}</title></circle>)}
            </g>
          ))}
        </svg>
        <div className="flex justify-between text-[10px] text-slate-400"><span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span></div>
        {legend}
      </div>
    );
  }

  // bar: one row per group, horizontal, stacked when split into columns
  const totals = data.map((d) => (stackable ? d.vals.reduce((a, v) => a + v, 0) : Math.max(...d.vals)));
  const max = Math.max(1, ...totals);
  return (
    <div className="card p-4">
      <ul className="space-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="grid grid-cols-[minmax(80px,30%)_1fr_auto] items-center gap-2 text-sm">
            <span className="truncate text-slate-700" title={d.label}>{d.label}</span>
            <span className="flex h-4 overflow-hidden rounded bg-slate-100">
              {stackable || series.length === 1
                ? d.vals.map((v, si) => v > 0 && <span key={si} style={{ width: `${(v / max) * 100}%`, background: COLORS[si % COLORS.length] }} title={`${series[si].label}: ${fmt(measure, v)}`} />)
                : <span style={{ width: `${(totals[i] / max) * 100}%`, background: COLORS[0] }} />}
            </span>
            <b className="w-20 text-right tabular-nums">{fmt(measure, spec.cols && stackable ? totals[i] : d.vals[0])}</b>
          </li>
        ))}
      </ul>
      {res.rowKeys.length > rows.length && <p className="mt-2 text-xs text-slate-500">Chart shows the top {rows.length}; the table has all {res.rowKeys.length}.</p>}
      {legend}
    </div>
  );
}

function SaveDialog({ open, onClose, current, canShare, saving, onSave }: {
  open: boolean; onClose: () => void; current: Saved | null; canShare: boolean; saving: boolean; onSave: (name: string, shared: boolean, asNew: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  useEffect(() => { if (open) { setName(current?.name ?? ""); setShared(current?.is_shared ?? false); } }, [open, current]);
  const mine = !!current?.mine;
  return (
    <Modal open={open} onClose={onClose} title={mine ? "Save report" : "Save as a new report"}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(name, shared, !mine); }}>
        <label className="block"><span className="label">Report name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus placeholder="e.g. Source-wise conversion" /></label>
        {canShare && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with my company (others can open it)</label>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          {mine && <button type="button" className="btn-ghost" disabled={saving || !name.trim()} onClick={() => onSave(name, shared, true)}>Save as new</button>}
          <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
