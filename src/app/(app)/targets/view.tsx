"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, Kpi } from "@/components/kit";
import { Modal } from "@/components/ui";
import { saveAgentTargets } from "@/lib/actions/targets";

export type TargetRow = {
  user_id: string; name: string; role: string; team: string | null;
  won: number; won_value: number; calls: number; calls_connected: number; talk_min: number;
  followups: number; visits: number; days_active: number; active_min: number;
  won_target: number | null; value_target: number | null; calls_target: number | null;
  followups_target: number | null; visits_target: number | null;
};

const inr = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const num = (v: number) => new Intl.NumberFormat("en-IN").format(v);

const METRICS = [
  { key: "won", target: "won_target", label: "Won leads", icon: "trophy", fmt: num },
  { key: "won_value", target: "value_target", label: "Revenue", icon: "rupee", fmt: inr },
  { key: "calls", target: "calls_target", label: "Calls made", icon: "phone", fmt: num },
  { key: "followups", target: "followups_target", label: "Follow-ups done", icon: "calendar", fmt: num },
  { key: "visits", target: "visits_target", label: "Field visits", icon: "pin", fmt: num },
] as const;
type Metric = (typeof METRICS)[number];

const val = (r: TargetRow, m: Metric) => Number(r[m.key] ?? 0);
const tgt = (r: TargetRow, m: Metric) => { const t = r[m.target]; return t == null ? null : Number(t); };

/** Average achievement of the targets that are set, 0-100+. */
function overall(r: TargetRow): number | null {
  const parts = METRICS.flatMap((m) => { const t = tgt(r, m); return t ? [Math.min(1.5, val(r, m) / t)] : []; });
  return parts.length ? (100 * parts.reduce((a, b) => a + b, 0)) / parts.length : null;
}

function Progress({ value, target, pace, fmt, daysLeft }: { value: number; target: number | null; pace: number; fmt: (v: number) => string; daysLeft: number }) {
  if (!target) return <div className="text-sm"><span className="font-semibold text-navy-900">{fmt(value)}</span> <span className="text-xs text-slate-400">no target</span></div>;
  const pct = (100 * value) / target;
  const behind = pct < pace * 100 - 5;
  const tone = pct >= 100 ? "bg-emerald-500" : !behind ? "bg-brand-500" : pct >= pace * 60 ? "bg-amber-500" : "bg-red-400";
  const need = Math.max(0, target - value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span><span className="text-sm font-semibold text-navy-900">{fmt(value)}</span> <span className="text-slate-500">/ {fmt(target)}</span></span>
        <span className={pct >= 100 ? "font-semibold text-emerald-700" : behind ? "font-semibold text-red-600" : "text-slate-500"}>{Math.round(pct)}%</span>
      </div>
      <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
        {pace > 0 && pace < 1 && <span className="absolute inset-y-0 w-0.5 bg-navy-900/40" style={{ left: `${pace * 100}%` }} title="Where you should be today" />}
      </div>
      {need > 0 && daysLeft > 0 && (
        <div className="mt-0.5 text-[11px] text-slate-500">{fmt(need)} to go · {fmt(Math.ceil(need / daysLeft))}/day for {daysLeft} day{daysLeft === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}

const hrs = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);

export function TargetsView({ month, rows, me, canEdit, editable, pace, daysLeft }: {
  month: string; rows: TargetRow[]; me: string; canEdit: boolean; editable: string[] | null; pace: number; daysLeft: number;
}) {
  const [editing, setEditing] = useState(false);
  const list = [...rows].sort((a, b) => (a.user_id === me ? -1 : b.user_id === me ? 1 : (overall(b) ?? -1) - (overall(a) ?? -1) || a.name.localeCompare(b.name)));
  const anyTarget = rows.some((r) => METRICS.some((m) => tgt(r, m)));

  if (!rows.length) return <div className="card p-8 text-center text-sm text-slate-500">No agents or team leaders to show yet.</div>;

  const sum = (m: Metric) => rows.reduce((a, r) => a + val(r, m), 0);
  const sumT = (m: Metric) => rows.reduce((a, r) => a + (tgt(r, m) ?? 0), 0);
  const kpi = (m: Metric) => {
    const t = sumT(m);
    return t ? `Target ${m.fmt(t)} · ${Math.round((100 * sum(m)) / t)}%` : "No target set";
  };

  return (
    <>
      {rows.length > 1 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {METRICS.map((m, i) => <Kpi key={m.key} label={m.label} value={m.fmt(sum(m))} sub={kpi(m)} icon={m.icon} tone={["green", "blue", "violet", "amber", "orange"][i]} />)}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {pace > 0 && pace < 1 ? <>The thin line on each bar shows where you should be today ({Math.round(pace * 100)}% of the month). </> : null}
          Calls = outgoing calls from the call app or typed in; follow-ups = marked done; visits = Field app visits.
        </p>
        <div className="flex gap-2">
          <Link href="/login-hours" className="btn-ghost btn-sm"><Icon name="clock" className="h-3.5 w-3.5" /> Login hours</Link>
          {canEdit && <button type="button" className="btn-primary btn-sm" onClick={() => setEditing(true)}><Icon name="target" className="h-3.5 w-3.5" /> Set targets</button>}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => {
          const o = overall(r);
          return (
            <div key={r.user_id} className={`card p-4 ${r.user_id === me ? "ring-2 ring-brand-200" : ""}`}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-navy-900">{r.name}{r.user_id === me && <span className="ml-1 text-xs text-brand-600">(you)</span>}</div>
                  <div className="truncate text-xs text-slate-500">{[r.team, r.role === "team_leader" ? "Team leader" : r.role === "agent" ? "Agent" : "Admin"].filter(Boolean).join(" · ")}</div>
                </div>
                {o != null && (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${o >= 100 ? "bg-emerald-50 text-emerald-700" : o >= pace * 100 - 5 ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}
                    title="Average of the targets that are set">{Math.round(o)}%{o < 100 && pace > 0 && pace < 1 ? (o >= pace * 100 - 5 ? " · on track" : " · behind") : ""}</span>
                )}
              </div>
              <div className="space-y-3">
                {METRICS.map((m) => (
                  <div key={m.key} className="grid grid-cols-[1.25rem_1fr] items-start gap-2">
                    <Icon name={m.icon} className="mt-0.5 h-4 w-4 text-slate-400" />
                    <div>
                      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{m.label}</div>
                      <Progress value={val(r, m)} target={tgt(r, m)} pace={pace} fmt={m.fmt} daysLeft={daysLeft} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
                <span title="Days the CRM was opened this month"><span className="font-semibold text-navy-900">{r.days_active}</span> days active</span>
                <span title="Time with the CRM open on screen"><span className="font-semibold text-navy-900">{hrs(r.active_min)}</span> on CRM</span>
                {r.calls > 0 && <span><span className="font-semibold text-navy-900">{r.calls_connected}</span> calls connected · {hrs(r.talk_min)} talk</span>}
              </div>
            </div>
          );
        })}
      </div>
      {!anyTarget && canEdit && <p className="mt-3 text-xs text-slate-500">No targets for this month yet. Click &ldquo;Set targets&rdquo; to add them.</p>}

      {canEdit && <TargetsModal open={editing} onClose={() => setEditing(false)} month={month} rows={rows.filter((r) => !editable || editable.includes(r.user_id))} />}
    </>
  );
}

const FIELDS = [
  { k: "won_target", label: "Won leads", w: "w-20" }, { k: "value_target", label: "Revenue (₹)", w: "w-32" },
  { k: "calls_target", label: "Calls", w: "w-20" }, { k: "followups_target", label: "Follow-ups", w: "w-20" }, { k: "visits_target", label: "Visits", w: "w-20" },
] as const;
type FieldKey = (typeof FIELDS)[number]["k"];

function TargetsModal({ open, onClose, month, rows }: { open: boolean; onClose: () => void; month: string; rows: TargetRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map((r) => [r.user_id,
    Object.fromEntries(FIELDS.map((f) => [f.k, r[f.k] != null ? String(Number(r[f.k])) : ""])) as Record<FieldKey, string>])));
  const set = (id: string, k: FieldKey, v: string) => setVals((s) => ({ ...s, [id]: { ...s[id], [k]: v.replace(/[^\d]/g, "") } }));
  const fillAll = (k: FieldKey) => { const v = vals[rows[0]?.user_id]?.[k] ?? ""; setVals((s) => Object.fromEntries(Object.entries(s).map(([id, x]) => [id, { ...x, [k]: v }]))); };
  const save = () => start(async () => {
    const r = await saveAgentTargets(month, rows.map((x) => ({ user_id: x.user_id, ...vals[x.user_id] })));
    if (r.error) { setErr(r.error); return; }
    router.refresh(); onClose();
  });
  const title = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Modal open={open} onClose={onClose} title={`Targets · ${title}`} wide>
      <p className="mb-3 text-sm text-slate-500">Leave a box empty for no target. &ldquo;Same for all&rdquo; copies the first person&apos;s value to everyone.</p>
      <div className="max-h-[55vh] overflow-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr><th className="th">User</th>{FIELDS.map((f) => (
              <th key={f.k} className="th">{f.label}{rows.length > 1 && <button type="button" className="ml-1 block text-[10px] font-medium normal-case text-brand-600 hover:underline" onClick={() => fillAll(f.k)}>Same for all</button>}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td className="td"><div className="font-medium text-navy-900">{r.name}</div><div className="text-xs text-slate-500">{r.team ?? ""}</div></td>
                {FIELDS.map((f) => (
                  <td key={f.k} className="td"><input className={`input ${f.w}`} inputMode="numeric" aria-label={`${r.name} ${f.label}`} value={vals[r.user_id]?.[f.k] ?? ""} onChange={(e) => set(r.user_id, f.k, e.target.value)} placeholder="—" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save targets"}</button>
      </div>
    </Modal>
  );
}
