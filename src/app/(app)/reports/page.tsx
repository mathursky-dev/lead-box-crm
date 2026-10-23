import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, ErrorBox, Empty } from "@/components/static";
import { Filters } from "@/components/filters";
import { METRICS, toRpcFilters, pickFilters, pct } from "@/lib/metrics";
import { PRESETS, rangeFor, fmtDay, money, type Preset } from "@/lib/dates";

export const metadata = { title: "360 Reports" };

const DIMS = {
  source: { label: "Sources", filter: "source_id" },
  product: { label: "Products", filter: "product_id" },
  number: { label: "WhatsApp numbers", filter: "number_id" },
  branch: { label: "Branches", filter: "branch_id" },
  department: { label: "Departments", filter: "department_id" },
  team: { label: "Teams", filter: "team_id" },
  user: { label: "Users", filter: "user_id" },
  status: { label: "Statuses", filter: "status_id" },
} as const;
type Dim = keyof typeof DIMS;
const TABS: [string, string][] = [...Object.entries(DIMS).map(([k, v]) => [k, v.label] as [string, string]), ["trend", "Daily trend"], ["whatsapp", "WhatsApp activity"]];
const COLS = ["total_leads", "new_allocations", "current_assigned", "untouched", "worked", "follow_up", "overdue", "converted", "lost", "invalid"] as const;

type Row = { key: string | null; metrics: Record<string, number>; won_value: number };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  if (!can(profile, "reports.view")) redirect("/dashboard");
  const manager = isManager(profile);
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "source";
  const refs = await loadRefs();
  const sb = await createClient();
  const filters = pickFilters(sp);
  const p = toRpcFilters(filters);
  const { data: visible } = await sb.rpc("lb_visible_user_ids");
  const visibleSet = new Set((visible ?? []) as string[]);
  const preset = (filters.preset as Preset) || "today";
  const { from, to } = rangeFor(preset, filters.from, filters.to);
  const period = `${PRESETS.find((x) => x.value === preset)?.label} · ${fmtDay(from.toISOString())} – ${fmtDay(new Date(to.getTime() - 1).toISOString())} (IST)`;
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(filters as Record<string, string>), ...extra }).toString();

  const names: Record<Dim, Map<string, string>> = {
    source: new Map(refs.sources.map((x) => [x.id, x.name])), product: new Map(refs.products.map((x) => [x.id, x.name])),
    number: new Map(refs.numbers.map((x) => [x.id, x.label])), branch: new Map(refs.branches.map((x) => [x.id, x.name])),
    department: new Map(refs.departments.map((x) => [x.id, x.name])), team: new Map(refs.teams.map((x) => [x.id, x.name])),
    user: new Map(refs.users.map((x) => [x.id, x.full_name])), status: new Map(refs.statuses.map((x) => [x.id, x.name])),
  };

  let body: React.ReactNode;
  if (tab === "trend") {
    const { data, error } = await sb.rpc("lb_report_trend", { p });
    const rows = (data ?? []) as { day: string; created: number; allocated: number; converted: number; won_value: number }[];
    const max = Math.max(1, ...rows.map((r) => Math.max(r.created, r.converted)));
    body = error ? <ErrorBox message={error.message} /> : !rows.length ? <Empty title="No activity in this period" /> : (
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b bg-slate-50"><tr><th className="th">Day (IST)</th><th className="th">Leads created</th><th className="th">First allocated</th><th className="th">Converted</th><th className="th">Won value</th><th className="th w-1/3">Created vs converted</th></tr></thead>
          <tbody className="divide-y">{rows.map((r) => (
            <tr key={r.day}>
              <td className="td whitespace-nowrap">{fmtDay(r.day + "T12:00:00Z")}</td>
              <td className="td">{r.created}</td><td className="td">{r.allocated}</td><td className="td">{r.converted}</td><td className="td">{money(r.won_value)}</td>
              <td className="td"><div className="space-y-1">
                <div className="h-2 rounded bg-navy-700" style={{ width: `${(r.created / max) * 100}%` }} title={`${r.created} created`} />
                <div className="h-2 rounded bg-brand-500" style={{ width: `${(r.converted / max) * 100}%` }} title={`${r.converted} converted`} />
              </div></td>
            </tr>))}</tbody>
        </table>
        <p className="p-3 text-xs text-slate-500">Navy = leads created that day; green = conversions dated that day (by conversion date).</p>
      </div>
    );
  } else if (tab === "whatsapp") {
    const { data, error } = await sb.rpc("lb_report_messages", { p: { from: p.from, to: p.to, number_id: filters.number_id } });
    const d = data as { inbound: number; outbound: number; delivered: number; read: number; failed: number; templates: number; chats: number; new_chats: number; by_number: { number_id: string; inbound: number; outbound: number; failed: number }[] } | null;
    const tile = (label: string, v: React.ReactNode, sub?: string) => (
      <div className="card p-4"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold text-navy-900">{v}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>
    );
    body = error || !d ? <ErrorBox message={error?.message ?? "Could not load"} /> : (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tile("Messages received", d.inbound)}{tile("Messages sent", d.outbound, `${d.templates} templates`)}
          {tile("Delivered", pct(d.delivered, d.outbound), `${d.delivered} of ${d.outbound}`)}{tile("Read", pct(d.read, d.outbound), `${d.read} of ${d.outbound}`)}
          {tile("Failed sends", d.failed)}{tile("Active chats", d.chats)}{tile("New chats", d.new_chats)}
        </div>
        {d.by_number.length > 0 && (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full text-sm"><thead className="border-b bg-slate-50"><tr><th className="th">Number</th><th className="th">Received</th><th className="th">Sent</th><th className="th">Failed</th></tr></thead>
              <tbody className="divide-y">{d.by_number.map((n) => <tr key={n.number_id}><td className="td">{names.number.get(n.number_id) ?? "—"}</td><td className="td">{n.inbound}</td><td className="td">{n.outbound}</td><td className="td">{n.failed}</td></tr>)}</tbody></table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Counts messages in chats you are allowed to see. Delivery/read rates are of messages sent in the period.</p>
      </>
    );
  } else {
    const dim = tab as Dim;
    const { data, error } = await sb.rpc("lb_report", { p, p_dim: dim });
    const rows = ((data ?? []) as Row[]).sort((a, b) => (b.metrics.total_leads ?? 0) - (a.metrics.total_leads ?? 0) || (b.metrics.current_assigned ?? 0) - (a.metrics.current_assigned ?? 0));
    const cell = (r: Row, m: string) => {
      const n = r.metrics[m] ?? 0;
      if (!r.key || !n) return <td key={m} className="td text-slate-500">{n}</td>;
      const extra: Record<string, string> = dim === "user" ? { metric: m, mu: r.key } : { metric: m, [DIMS[dim].filter]: r.key };
      return <td key={m} className="td"><Link className="hover:text-brand-700 hover:underline" href={`/leads?${qs(extra)}`}>{n}</Link></td>;
    };
    body = error ? <ErrorBox message={error.message} /> : !rows.length ? <Empty title="No data for these filters" /> : (
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b bg-slate-50"><tr>
            <th className="th">{DIMS[dim].label.replace(/s$/, "")}</th>
            {COLS.map((c) => <th key={c} className="th" title={METRICS[c].def}>{METRICS[c].label}</th>)}
            <th className="th">Won value</th><th className="th" title="Cohort: first allocated in period and now won">Conv. rate (cohort)</th>
          </tr></thead>
          <tbody className="divide-y">{rows.map((r) => (
            <tr key={r.key ?? "none"}>
              <td className="td font-medium text-navy-900">{r.key ? names[dim].get(r.key) ?? "Unknown" : <span className="text-slate-400">Not set</span>}</td>
              {COLS.map((c) => cell(r, c))}
              <td className="td">{money(r.won_value)}</td>
              <td className="td">{pct(r.metrics.cohort_won ?? 0, r.metrics.cohort_allocated ?? 0)} <span className="text-xs text-slate-400">({r.metrics.cohort_won ?? 0}/{r.metrics.cohort_allocated ?? 0})</span></td>
            </tr>))}</tbody>
        </table>
        <p className="p-3 text-xs text-slate-500">
          Unique leads per row; a lead appears once per row it belongs to. {dim === "user" || dim === "team" ? "Rows credit the user (and their team) per metric rules — e.g. conversions to the owner at conversion." : "Rows group by the lead's current value."} Click any number for the exact list. Period metrics use the selected range; Current Assigned, Untouched, Follow-up and Overdue are current workload.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="360 Reports" sub={`${manager ? "Team" : "My"} performance across every dimension · ${period}`}
        actions={<Link className="btn-ghost" href="/customers">Customer 360 directory</Link>} />
      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        {TABS.map(([t, l]) => (
          <Link key={t} href={`/reports?${qs({ tab: t })}`} className={`whitespace-nowrap border-b-2 px-3 py-2 ${tab === t ? "border-brand-600 font-medium text-navy-900" : "border-transparent text-slate-600 hover:text-navy-900"}`}>{l}</Link>
        ))}
      </nav>
      <Filters sp={filters} refs={refs} manager={manager} visible={visibleSet} basePath="/reports" hidden={{ tab }} />
      {body}
    </>
  );
}
