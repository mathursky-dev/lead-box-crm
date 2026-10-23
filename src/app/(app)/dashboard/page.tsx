import Link from "next/link";
import { requireProfile, isManager, ROLE_LABEL } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, ErrorBox } from "@/components/static";
import { METRICS, COHORT_RATE_DEF, toRpcFilters, pickFilters, pct } from "@/lib/metrics";
import { rangeFor, fmtDay, money, type Preset } from "@/lib/dates";
import { Filters } from "@/components/filters";

export const metadata = { title: "Dashboard" };

type Dash = { totals: Record<string, number>; won_value: number; by_user: Record<string, Record<string, number>> };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile, company } = await requireProfile();
  const manager = isManager(profile);
  const refs = await loadRefs();
  const sb = await createClient();
  const filters = pickFilters(sp);
  const [{ data, error }, { data: visible }] = await Promise.all([
    sb.rpc("lb_dashboard", { p: toRpcFilters(filters) }),
    sb.rpc("lb_visible_user_ids"),
  ]);
  const d = (data ?? { totals: {}, won_value: 0, by_user: {} }) as Dash;
  const t = (k: string) => d.totals[k] ?? 0;
  const qs = (extra: Record<string, string> = {}) => new URLSearchParams({ ...(filters as Record<string, string>), ...extra }).toString();
  const drill = (metric: string, user?: string) => `/leads?${qs({ metric, ...(user ? { mu: user } : {}) })}`;
  const preset = (filters.preset as Preset) || "today";
  const { from, to } = rangeFor(preset, filters.from, filters.to);
  const visibleSet = new Set((visible ?? []) as string[]);
  const perfUsers = refs.users.filter((u) => visibleSet.has(u.id) && (u.is_active || d.by_user[u.id]) && (!filters.user_id || u.id === filters.user_id) && (!filters.team_id || u.team_id === filters.team_id));

  const cohort = <span>{t("cohort_won")} won / {t("cohort_allocated")} first allocated</span>;

  return (
    <>
      <PageHeader title={manager ? "Team dashboard" : "My dashboard"} sub={`${profile.full_name} · ${ROLE_LABEL[profile.role]} · ${company.name} · ${fmtDay(from.toISOString())} – ${fmtDay(new Date(to.getTime() - 1).toISOString())} (IST)`} />
      <Filters sp={filters} refs={refs} manager={manager} visible={visibleSet} basePath="/dashboard" />
      {error && <div className="mb-4"><ErrorBox message={error.message} /></div>}

      {!manager ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Card d={d} drill={drill} metric="current_assigned" />
          <Card d={d} drill={drill} metric="new_allocations" />
          <Card d={d} drill={drill} metric="untouched" />
          <Card d={d} drill={drill} metric="worked" />
          <Card d={d} drill={drill} metric="followups_due" />
          <Card d={d} drill={drill} metric="overdue" />
          <Card d={d} drill={drill} metric="converted" sub={money(d.won_value)} />
          <div className="card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Lost / Invalid</div>
            <div className="mt-1 text-2xl font-semibold text-navy-900">
              <Link className="hover:text-brand-700" href={drill("lost")}>{t("lost")}</Link> / <Link className="hover:text-brand-700" href={drill("invalid")}>{t("invalid")}</Link>
            </div>
          </div>
          <Card d={d} drill={drill} metric="cohort_won" label="Conversion rate (cohort)" value={pct(t("cohort_won"), t("cohort_allocated"))} sub={cohort} />
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Card d={d} drill={drill} metric="total_leads" />
            <Card d={d} drill={drill} metric="unassigned" />
            <Card d={d} drill={drill} metric="allocated" />
            <Card d={d} drill={drill} metric="worked" />
            <Card d={d} drill={drill} metric="follow_up" />
            <Card d={d} drill={drill} metric="converted" />
            <Card d={d} drill={drill} metric="lost" />
            <Card d={d} drill={drill} metric="invalid" />
            <Card d={d} drill={drill} metric="converted" label="Won value" value={money(d.won_value)} sub="Sum of won value for period conversions" />
            <Card d={d} drill={drill} metric="cohort_won" label="Conversion rate (cohort)" value={pct(t("cohort_won"), t("cohort_allocated"))} sub={cohort} />
          </section>
          <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card d={d} drill={drill} metric="current_assigned" /><Card d={d} drill={drill} metric="untouched" /><Card d={d} drill={drill} metric="followups_due" /><Card d={d} drill={drill} metric="overdue" />
          </section>
        </>
      )}

      <section className="card mt-5 p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Leads by status (current)</h2>
        <div className="flex flex-wrap gap-2">
          {refs.statuses.map((s) => (
            <Link key={s.id} href={drill(`status:${s.id}`)} className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-brand-500">
              <span className="text-slate-600">{s.name}</span> <b className="ml-1 text-navy-900">{t(`status:${s.id}`)}</b>
            </Link>
          ))}
        </div>
      </section>

      {manager && (
        <section className="card mt-5 overflow-x-auto">
          <div className="p-4 pb-2"><h2 className="text-sm font-semibold text-navy-900">User performance</h2>
            <p className="text-xs text-slate-500">Per-user figures count unique leads per user; a lead handled by two users appears in both rows, so columns don&apos;t sum to the company row, which counts each lead once.</p></div>
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-y bg-slate-50"><tr>
              {["User", "Opening Assigned", "New Allocations", "Transfers In", "Transfers Out", "Current Assigned", "Untouched", "Worked", "Follow-up", "Converted", "Lost", "Invalid", "Conversion Rate (cohort)"].map((h) => <th key={h} className="th">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y">
              {perfUsers.map((u) => {
                const r = d.by_user[u.id] ?? {};
                const cell = (m: string) => <td className="td"><Link className="hover:text-brand-700 hover:underline" href={drill(m, u.id)}>{r[m] ?? 0}</Link></td>;
                return (
                  <tr key={u.id}>
                    <td className="td font-medium text-navy-900">{u.full_name}{!u.is_active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}</td>
                    {cell("opening_assigned")}{cell("new_allocations")}{cell("transfers_in")}{cell("transfers_out")}{cell("current_assigned")}
                    {cell("untouched")}{cell("worked")}{cell("follow_up")}{cell("converted")}{cell("lost")}{cell("invalid")}
                    <td className="td"><Link className="hover:underline" href={drill("cohort_won", u.id)}>{pct(r.cohort_won ?? 0, r.cohort_allocated ?? 0)}</Link> <span className="text-xs text-slate-400">({r.cohort_won ?? 0}/{r.cohort_allocated ?? 0})</span></td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-medium">
                <td className="td">Company (unique leads)</td>
                {["opening_assigned", "new_allocations", "transfers_in", "transfers_out", "current_assigned", "untouched", "worked", "follow_up", "converted", "lost", "invalid"].map((m) => (
                  <td key={m} className="td"><Link className="hover:underline" href={drill(m)}>{t(m)}</Link></td>
                ))}
                <td className="td">{pct(t("cohort_won"), t("cohort_allocated"))}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <details className="card mt-5 p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-navy-900">Metric definitions</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {Object.entries(METRICS).map(([k, m]) => (
            <div key={k}><dt className="font-medium">{m.label} <span className="text-xs font-normal text-slate-400">({m.kind === "current" ? "current workload" : "selected period"})</span></dt><dd className="text-slate-600">{m.def}</dd></div>
          ))}
          <div className="sm:col-span-2"><dt className="font-medium">Conversion rate (cohort)</dt><dd className="text-slate-600">{COHORT_RATE_DEF}</dd></div>
          <div className="sm:col-span-2 text-slate-600">Every number links to the exact list of leads behind it; card totals and list totals come from the same query.</div>
        </dl>
      </details>
    </>
  );
}

function Card({ d, drill, metric, label, value, sub }: { d: Dash; drill: (m: string) => string; metric: string; label?: string; value?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Link href={drill(metric)} title={METRICS[metric]?.def} className="card block p-4 transition hover:border-brand-500 hover:shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label ?? METRICS[metric]?.label}</div>
      <div className="mt-1 text-2xl font-semibold text-navy-900">{value ?? d.totals[metric] ?? 0}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Link>
  );
}
