import Link from "next/link";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, Pager, Empty, ErrorBox } from "@/components/static";
import { METRICS, toRpcFilters, pickFilters } from "@/lib/metrics";
import { PRESETS } from "@/lib/dates";
import { LeadTable } from "./lead-table";

export const metadata = { title: "Leads" };
const LIMIT = 50;

type SP = Record<string, string | undefined>;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const refs = await loadRefs();
  const sb = await createClient();
  const offset = Math.max(0, Number(sp.offset) || 0);

  // Dashboard drill-down: exactly the rows behind the card.
  const metric = sp.metric;
  let rows: Row[] = [];
  let total = 0;
  let error: string | null = null;
  if (metric) {
    const statusMetric = metric.startsWith("status:");
    if (!METRICS[metric] && !statusMetric) error = "Unknown metric";
    else {
      const { data, error: e } = await sb.rpc("lb_metric_leads", {
        p: toRpcFilters(pickFilters(sp)), p_metric: metric, p_user: sp.mu || null, p_limit: LIMIT, p_offset: offset,
      });
      if (e) error = e.message; else { rows = data.rows; total = data.total; }
    }
  } else {
    const { data, error: e } = await sb.rpc("lb_list_leads", {
      p: {
        q: sp.q, status_id: sp.status_id, category: sp.category, owner_id: sp.owner_id, unassigned: sp.unassigned === "1",
        open_only: sp.open === "1", product_id: sp.product_id, source_id: sp.source_id, team_id: sp.team_id, branch_id: sp.branch_id,
        number_id: sp.number_id, priority: sp.priority, stale: sp.stale === "1", tag_id: sp.tag_id, followup: sp.followup, sort: sp.sort, limit: LIMIT, offset,
      },
    });
    if (e) error = e.message; else { rows = data.rows; total = data.total; }
  }

  const statusName = metric?.startsWith("status:") ? refs.statuses.find((s) => s.id === metric.slice(7))?.name : null;
  const mUser = sp.mu ? refs.users.find((u) => u.id === sp.mu)?.full_name : null;
  const preset = PRESETS.find((p) => p.value === (sp.preset || "today"))?.label;
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "offset") as [string, string][]).toString();

  return (
    <>
      <PageHeader title={metric ? `${statusName ? `Status: ${statusName}` : METRICS[metric]?.label ?? "Leads"}${mUser ? ` · ${mUser}` : ""}` : "Leads"}
        sub={metric ? <>{statusName ? "Current leads in this status." : METRICS[metric]?.def} {METRICS[metric]?.kind === "period" && <b>Period: {preset}.</b>} <Link className="text-brand-700 hover:underline" href={`/dashboard?${new URLSearchParams(pickFilters(sp) as Record<string, string>)}`}>Back to dashboard</Link></> : `${total} lead${total === 1 ? "" : "s"}`}
        actions={<>
          {can(profile, "leads.export") && <a className="btn-ghost" href={`/api/export/leads?${exportQs}`}>Export CSV</a>}
          {can(profile, "leads.create") && <Link className="btn-primary" href="/leads/new">+ New lead</Link>}
        </>} />

      {!metric && (
        <form className="card mb-3 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
          <input className="input sm:col-span-2" name="q" defaultValue={sp.q} placeholder="Search name, phone, email, LB-123" />
          <select className="input" name="status_id" defaultValue={sp.status_id ?? ""}><option value="">All statuses</option>{refs.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          {isManager(profile) && (
            <select className="input" name="owner_id" defaultValue={sp.owner_id ?? ""}><option value="">All owners</option>{refs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.is_active ? "" : " (inactive)"}</option>)}</select>
          )}
          <select className="input" name="product_id" defaultValue={sp.product_id ?? ""}><option value="">All products</option>{refs.products.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="input" name="source_id" defaultValue={sp.source_id ?? ""}><option value="">All sources</option>{refs.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          {isManager(profile) && <select className="input" name="team_id" defaultValue={sp.team_id ?? ""}><option value="">All teams</option>{refs.teams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <select className="input" name="number_id" defaultValue={sp.number_id ?? ""}><option value="">All numbers</option>{refs.numbers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <select className="input" name="priority" defaultValue={sp.priority ?? ""}><option value="">Any priority</option><option value="high,urgent">High + urgent</option>{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select>
          <select className="input" name="tag_id" defaultValue={sp.tag_id ?? ""}><option value="">Any tag</option>{refs.tags.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="input" name="followup" defaultValue={sp.followup ?? ""}><option value="">Any follow-up</option><option value="today">Due today</option><option value="overdue">Overdue</option></select>
          <select className="input" name="sort" defaultValue={sp.sort ?? ""}><option value="">Recent activity</option><option value="created">Newest</option><option value="followup">Next follow-up</option></select>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" name="open" value="1" defaultChecked={sp.open === "1"} /> Open</label>
            {isManager(profile) && <label className="flex items-center gap-1"><input type="checkbox" name="unassigned" value="1" defaultChecked={sp.unassigned === "1"} /> Unassigned</label>}
            <label className="flex items-center gap-1" title="No activity for 14+ days"><input type="checkbox" name="stale" value="1" defaultChecked={sp.stale === "1"} /> Stale 14d+</label>
          </div>
          <div className="flex gap-2"><button className="btn-navy flex-1">Apply</button><Link href="/leads" className="btn-ghost">Clear</Link></div>
        </form>
      )}

      {error ? <ErrorBox message={error} /> : rows.length === 0 ? (
        <Empty title="No leads found">{metric ? "Nothing matches this metric for the selected filters." : "Try different filters, create a lead, or import a CSV."}</Empty>
      ) : (
        <LeadTable rows={rows} canAssign={can(profile, "leads.assign")}
          users={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))} />
      )}
      <Pager total={total} limit={LIMIT} offset={offset} params={sp} basePath="/leads" />
    </>
  );
}

type Row = {
  id: string; lead_no: number; customer_name: string | null; phone_e164: string; status_name: string; status_category: string;
  priority: string; owner_id: string | null; owner_name: string | null; product_name: string | null; source_name: string | null;
  expected_value: number | null; won_value: number | null; created_at: string; last_activity_at: string; next_followup_at: string | null;
};
