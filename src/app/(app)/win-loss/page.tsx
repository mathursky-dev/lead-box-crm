import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, can, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox, Empty } from "@/components/static";
import { Kpi, Panel, Bars, Legend } from "@/components/kit";
import { Tx } from "@/components/lang";
import { fmtDay, money } from "@/lib/dates";
import { PERIODS, resolvePeriod } from "@/lib/periods";

export const metadata = { title: "Win / Loss" };
export const dynamic = "force-dynamic";

type Group = { k: "source" | "owner" | "product" | "month"; id: string | null; name: string | null; won: number; lost: number; invalid: number; won_value: number; lost_value: number };
type WL = {
  totals: { won: number; lost: number; invalid: number; won_value: number; lost_value: number; avg_days_won: number | null; avg_days_lost: number | null };
  open: number; reasons: { reason: string; category: string; n: number; value: number }[]; groups: Group[];
};
const n = (v: unknown) => Number(v ?? 0);
const rate = (w: number, l: number) => (w + l ? Math.round((w / (w + l)) * 100) : null);
const WON = "#16a34a", LOST = "#f97316", INVALID = "#94a3b8";

export default async function WinLossPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  if (!can(profile, "reports.view")) redirect("/dashboard");
  const p = resolvePeriod(sp);
  const sb = await createClient();
  const { data, error } = await sb.rpc("lb_win_loss", { p_from: p.start, p_to: p.end });
  const wl = data as WL | null;
  const t = wl?.totals;
  const closed = n(t?.won) + n(t?.lost) + n(t?.invalid);
  const winRate = rate(n(t?.won), n(t?.lost));
  const groups = (k: Group["k"]) => (wl?.groups ?? []).filter((g) => g.k === k);
  const maxReason = Math.max(1, ...(wl?.reasons ?? []).map((r) => n(r.n)));
  const lostTotal = n(t?.lost) + n(t?.invalid);
  const period = `${fmtDay(p.from + "T12:00:00Z")} – ${fmtDay(p.to + "T12:00:00Z")}`;
  const months = groups("month").sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return (
    <>
      <PageHeader icon="trophy" tone="green" title="Win / Loss report"
        sub="Why deals are won or lost: reasons, sources, team members and products for leads closed in the period."
        actions={isAdmin(profile) ? <Link href="/settings/lost-reasons" className="btn-ghost"><Tx>Lost reasons</Tx></Link> : undefined} />
      <form action="/win-loss" className="card mb-4 grid grid-cols-2 gap-1.5 p-2 sm:flex sm:flex-wrap sm:items-center">
        <select className="input h-8 py-1! text-xs! sm:w-auto" name="preset" defaultValue={p.preset} aria-label="Period">
          {PERIODS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        <input className="input h-8 py-1! text-xs! sm:w-36" type="date" name="from" defaultValue={p.from} aria-label="From" />
        <input className="input h-8 py-1! text-xs! sm:w-36" type="date" name="to" defaultValue={p.to} aria-label="To" />
        <button className="btn-primary h-8 text-xs">Apply</button>
        <span className="col-span-2 text-xs text-slate-500 sm:ml-auto">Closed {period} (IST)</span>
      </form>
      {error && <ErrorBox message={error.message.includes("lb_win_loss") ? "The Win / Loss report needs the latest database update. Ask the platform owner to run it." : error.message} />}
      {!error && wl && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Won" icon="trophy" tone="green" value={n(t?.won)} sub={money(t?.won_value)} />
            <Kpi label="Lost" icon="xCircle" tone="orange" value={n(t?.lost)} sub={money(t?.lost_value)} />
            <Kpi label="Invalid" icon="ban" tone="slate" value={n(t?.invalid)} />
            <Kpi label="Win rate" icon="percent" tone="blue" value={winRate === null ? "—" : `${winRate}%`} sub="Won ÷ (won + lost)" />
            <Kpi label="Still open" icon="target" tone="violet" value={n(wl.open)} href="/leads?open=1" sub={t?.avg_days_won != null ? `Avg. ${t.avg_days_won} days to win` : undefined} />
          </div>
          {!closed ? <div className="card"><Empty title="No closed leads in this period" icon="trophy">Mark leads Won, Lost or Invalid and they show up here.</Empty></div> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Reasons for lost leads" icon="xCircle" tone="amber" className="lg:col-span-2"
                sub={t?.avg_days_lost != null ? `Lost leads took ${t.avg_days_lost} days on average.` : undefined}>
                {!wl.reasons.length ? <p className="text-sm text-slate-500">No lost or invalid leads.</p> : (
                  <ul className="space-y-2">
                    {wl.reasons.map((r) => (
                      <li key={r.category + r.reason}>
                        <div>
                          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate font-medium text-navy-900 ">{r.reason} <span className={`badge ml-1 ${r.category === "invalid" ? "bg-slate-100 text-slate-600" : "bg-orange-50 text-orange-700"}`}>{r.category === "invalid" ? "Invalid" : "Lost"}</span></span>
                            <span className="shrink-0 text-xs text-slate-500"><b className="text-navy-900">{n(r.n)}</b> · {Math.round((n(r.n) / Math.max(1, lostTotal)) * 100)}%{n(r.value) ? ` · ${money(r.value)}` : ""}</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(n(r.n) / maxReason) * 100}%`, background: r.category === "invalid" ? INVALID : LOST }} /></div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {months.length > 1 && (
                <Panel title="Month by month" icon="chart" className="lg:col-span-2" actions={<Legend items={[{ name: "Won", color: WON }, { name: "Lost", color: LOST }, { name: "Invalid", color: INVALID }]} />}>
                  <Bars rows={months.map((m) => ({ label: String(m.name), values: [n(m.won), n(m.lost), n(m.invalid)] }))} series={[{ name: "Won", color: WON }, { name: "Lost", color: LOST }, { name: "Invalid", color: INVALID }]} />
                </Panel>
              )}
              <GroupTable title="By source" icon="link" rows={groups("source")} empty="No source" />
              <GroupTable title="By team member" icon="user" rows={groups("owner")} empty="Unassigned" />
              <GroupTable title="By product" icon="cart" rows={groups("product")} empty="No product" />
            </div>
          )}
        </>
      )}
    </>
  );
}

function GroupTable({ title, icon, rows, empty }: { title: string; icon: string; rows: Group[]; empty: string }) {
  return (
    <Panel title={title} icon={icon}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th text-right"><Tx>Won</Tx></th><th className="th text-right"><Tx>Lost</Tx></th><th className="th text-right"><Tx>Win rate</Tx></th><th className="th text-right"><Tx>Won value</Tx></th></tr></thead>
          <tbody className="divide-y">
            {rows.map((g) => {
              const r = rate(n(g.won), n(g.lost));
              return (
                <tr key={g.id ?? "none"}>
                  <td className="td">{g.name ?? <span className="text-slate-400">{empty}</span>}</td>
                  <td className="td text-right font-semibold text-green-700">{n(g.won)}</td>
                  <td className="td text-right text-orange-700">{n(g.lost)}{n(g.invalid) ? <span className="text-slate-400"> +{n(g.invalid)}</span> : null}</td>
                  <td className="td text-right">{r === null ? "—" : <span className={`badge ${r >= 50 ? "bg-green-50 text-green-700" : r >= 25 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>{r}%</span>}</td>
                  <td className="td text-right">{money(g.won_value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
