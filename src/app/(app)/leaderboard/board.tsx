"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, Kpi } from "@/components/kit";
import { Modal } from "@/components/ui";
import { saveTargets } from "@/lib/actions/alerts";

export type BoardRow = {
  user_id: string; name: string; role: string; team: string | null;
  assigned: number; won: number; won_value: number; conversion: number | null;
  fu_done: number; fu_on_time: number; fu_missed: number;
  replies: number; resp_median_min: number | null;
  won_target: number | null; value_target: number | null;
};

const SORTS = [
  { key: "score", label: "Overall", icon: "trophy" },
  { key: "value", label: "Revenue", icon: "rupee" },
  { key: "won", label: "Won", icon: "check" },
  { key: "conversion", label: "Conversion", icon: "percent" },
  { key: "response", label: "Reply time", icon: "clock" },
  { key: "followups", label: "Follow-ups", icon: "calendar" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

const inr = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const dur = (m: number | null) => {
  if (m == null) return "—";
  if (m < 1) return "< 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${(m / 1440).toFixed(1)} days`;
};

/** Target achievement %: average of the targets that are set (won count, revenue). */
function achievement(r: BoardRow): number | null {
  const parts: number[] = [];
  if (r.won_target) parts.push(r.won / r.won_target);
  if (r.value_target) parts.push(Number(r.won_value) / r.value_target);
  return parts.length ? (100 * parts.reduce((a, b) => a + b, 0)) / parts.length : null;
}
/** Follow-up discipline: share done on time among those due this month. */
const fuScore = (r: BoardRow) => (r.fu_done + r.fu_missed ? r.fu_on_time / (r.fu_done + r.fu_missed) : -1);

function sorter(key: SortKey, anyTarget: boolean) {
  const by = (f: (r: BoardRow) => number) => (a: BoardRow, b: BoardRow) => f(b) - f(a) || Number(b.won_value) - Number(a.won_value) || a.name.localeCompare(b.name);
  switch (key) {
    case "value": return by((r) => Number(r.won_value));
    case "won": return by((r) => r.won);
    case "conversion": return by((r) => (r.assigned >= 1 ? r.conversion ?? 0 : -1));
    case "response": return by((r) => (r.resp_median_min == null ? -1e9 : -r.resp_median_min));
    case "followups": return by(fuScore);
    default: return anyTarget ? by((r) => achievement(r) ?? -1) : by((r) => Number(r.won_value));
  }
}

function Bar({ value, target, fmt }: { value: number; target: number | null; fmt: (v: number) => string }) {
  if (!target) return <span className="font-semibold text-navy-900">{fmt(value)}</span>;
  const pct = Math.min(100, (100 * value) / target);
  const tone = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-brand-500" : pct >= 30 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="min-w-28">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-sm font-semibold text-navy-900">{fmt(value)}</span>
        <span className="text-slate-500">/ {fmt(target)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

const MEDAL = ["bg-amber-400 text-white", "bg-slate-300 text-navy-900", "bg-orange-300 text-white"];

export function Board({ month, rows, me, canEdit, editable, current }: {
  month: string; rows: BoardRow[]; me: string; canEdit: boolean; editable: string[] | null; current: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("score");
  const [editing, setEditing] = useState(false);
  const anyTarget = rows.some((r) => r.won_target || r.value_target);
  const list = useMemo(() => [...rows].sort(sorter(sort, anyTarget)), [rows, sort, anyTarget]);

  const tot = rows.reduce((a, r) => ({ won: a.won + r.won, value: a.value + Number(r.won_value), assigned: a.assigned + r.assigned, missed: a.missed + r.fu_missed }),
    { won: 0, value: 0, assigned: 0, missed: 0 });
  const tWon = rows.reduce((a, r) => a + (r.won_target ?? 0), 0);
  const tVal = rows.reduce((a, r) => a + Number(r.value_target ?? 0), 0);
  const resp = rows.filter((r) => r.resp_median_min != null).map((r) => r.resp_median_min!).sort((a, b) => a - b);
  const medResp = resp.length ? resp[Math.floor(resp.length / 2)] : null;

  if (!rows.length) return <div className="card p-8 text-center text-sm text-slate-500">No agents or team leaders in this company yet.</div>;

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Won" value={tot.won} sub={tWon ? `Target ${tWon} · ${Math.round((100 * tot.won) / tWon)}%` : `${tot.assigned} leads assigned`} icon="trophy" tone="green" />
        <Kpi label="Revenue" value={inr(tot.value)} sub={tVal ? `Target ${inr(tVal)} · ${Math.round((100 * tot.value) / tVal)}%` : "Won value this month"} icon="rupee" tone="blue" />
        <Kpi label="Conversion" value={tot.assigned ? `${((100 * tot.won) / tot.assigned).toFixed(1)}%` : "—"} sub="Won ÷ leads assigned this month" icon="percent" tone="violet" />
        <Kpi label="Typical first reply" value={dur(medResp)} sub={`${tot.missed} follow-ups missed`} icon="clock" tone="amber" />
      </div>

      {list.length >= 3 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {list.slice(0, 3).map((r, i) => (
            <div key={r.user_id} className={`card relative overflow-hidden p-4 ${i === 0 ? "ring-2 ring-amber-300" : ""}`}>
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-bold ${MEDAL[i]}`}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-navy-900">{r.name}{r.user_id === me && <span className="ml-1 text-xs text-brand-600">(you)</span>}</div>
                  <div className="truncate text-xs text-slate-500">{r.team ?? (r.role === "team_leader" ? "Team leader" : "Agent")}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
                <div><div className="text-base font-bold text-navy-900">{r.won}</div>won</div>
                <div><div className="truncate text-base font-bold text-navy-900">{inr(Number(r.won_value))}</div>revenue</div>
                <div><div className="text-base font-bold text-navy-900">{sort === "response" ? dur(r.resp_median_min) : (achievement(r) != null ? `${Math.round(achievement(r)!)}%` : r.conversion != null ? `${r.conversion}%` : "—")}</div>
                  {sort === "response" ? "first reply" : achievement(r) != null ? "of target" : "conversion"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5 overflow-x-auto text-xs">
          {SORTS.map((s) => (
            <button key={s.key} type="button" onClick={() => setSort(s.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-semibold transition ${sort === s.key ? "border-transparent bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-brand-50 hover:text-brand-700"}`}>
              <Icon name={s.icon} className="h-3.5 w-3.5" />{s.label}
            </button>
          ))}
        </div>
        {canEdit && <button type="button" className="btn-primary btn-sm" onClick={() => setEditing(true)}><Icon name="target" className="h-3.5 w-3.5" /> Set targets</button>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-12">#</th><th className="th">Agent</th><th className="th text-right">Leads</th>
              <th className="th">Won</th><th className="th">Revenue</th><th className="th text-right">Conversion</th>
              <th className="th text-right" title="Median time from a customer's first unanswered message to this person's reply">First reply</th>
              <th className="th text-right" title="Follow-ups due this month: done (on time) / still open after due time">Follow-ups</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((r, i) => (
              <tr key={r.user_id} className={r.user_id === me ? "bg-brand-50/50" : "hover:bg-slate-50"}>
                <td className="td">{i < 3 ? <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${MEDAL[i]}`}>{i + 1}</span> : <span className="pl-2 text-slate-500">{i + 1}</span>}</td>
                <td className="td">
                  <div className="font-medium text-navy-900">{r.name}{r.user_id === me && <span className="ml-1 text-xs text-brand-600">(you)</span>}</div>
                  <div className="text-xs text-slate-500">{[r.team, r.role === "team_leader" ? "Team leader" : r.role === "agent" ? "Agent" : "Admin"].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="td text-right">{r.assigned}</td>
                <td className="td"><Bar value={r.won} target={r.won_target} fmt={String} /></td>
                <td className="td"><Bar value={Number(r.won_value)} target={r.value_target ? Number(r.value_target) : null} fmt={inr} /></td>
                <td className="td text-right">{r.conversion != null ? `${r.conversion}%` : "—"}</td>
                <td className="td text-right"><span className={r.resp_median_min != null && r.resp_median_min > 60 ? "text-red-600" : ""}>{dur(r.resp_median_min)}</span>
                  {r.replies > 0 && <div className="text-xs text-slate-400">{r.replies} replies</div>}</td>
                <td className="td text-right">
                  <span className="text-emerald-700">{r.fu_done}</span>
                  {r.fu_done > 0 && <span className="text-xs text-slate-400"> ({r.fu_on_time} on time)</span>}
                  {" / "}<span className={r.fu_missed ? "font-semibold text-red-600" : "text-slate-400"}>{r.fu_missed} missed</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!anyTarget && canEdit && current && <p className="mt-3 text-xs text-slate-500">Tip: set monthly targets so &ldquo;Overall&rdquo; ranks by target achievement.</p>}

      {canEdit && <TargetsModal open={editing} onClose={() => setEditing(false)} month={month} rows={rows.filter((r) => !editable || editable.includes(r.user_id))} />}
    </>
  );
}

function TargetsModal({ open, onClose, month, rows }: { open: boolean; onClose: () => void; month: string; rows: BoardRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>();
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map((r) => [r.user_id, { won: r.won_target?.toString() ?? "", value: r.value_target != null ? String(Number(r.value_target)) : "" }])));
  const set = (id: string, k: "won" | "value", v: string) => setVals((s) => ({ ...s, [id]: { ...s[id], [k]: v.replace(/[^\d]/g, "") } }));
  const save = () => start(async () => {
    const r = await saveTargets(month, rows.map((x) => ({ user_id: x.user_id, won_target: vals[x.user_id]?.won ?? "", value_target: vals[x.user_id]?.value ?? "" })));
    setMsg(r);
    if (!r.error) { router.refresh(); onClose(); }
  });
  const title = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Modal open={open} onClose={onClose} title={`Targets · ${title}`} wide>
      <p className="mb-3 text-sm text-slate-500">Leave a box empty for no target. Won = leads moved to a Won status this month; revenue = their won value.</p>
      <div className="max-h-[55vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white"><tr><th className="th">User</th><th className="th">Won leads</th><th className="th">Revenue (₹)</th></tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td className="td"><div className="font-medium text-navy-900">{r.name}</div><div className="text-xs text-slate-500">{r.team ?? ""}</div></td>
                <td className="td"><input className="input w-24" inputMode="numeric" value={vals[r.user_id]?.won ?? ""} onChange={(e) => set(r.user_id, "won", e.target.value)} placeholder="—" /></td>
                <td className="td"><input className="input w-36" inputMode="numeric" value={vals[r.user_id]?.value ?? ""} onChange={(e) => set(r.user_id, "value", e.target.value)} placeholder="—" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg?.error && <p className="mt-2 text-sm text-red-600">{msg.error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save targets"}</button>
      </div>
    </Modal>
  );
}
