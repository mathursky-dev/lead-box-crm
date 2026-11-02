import Link from "next/link";
import { requireProfile, isManager, isAdmin, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ListFooter } from "./list-footer";
import { PAGE_SIZES } from "./page-sizes";
import { PageHeader, Empty, ErrorBox } from "@/components/static";
import { METRICS, toRpcFilters, pickFilters } from "@/lib/metrics";
import { PRESETS, rangeFrom } from "@/lib/dates";
import { LeadTable } from "./lead-table";
import { StatusCards, type Card } from "./status-cards";
import { LeadsToolbar, CustomizeButton } from "./leads-toolbar";
import { ChatPopupHost } from "./chat-popup-host";
import type { LeadTableLayout, LeadCardsPref, LeadViews } from "@/lib/actions/prefs";
import { Icon } from "@/components/kit";

export const metadata = { title: "Leads" };

type SP = Record<string, string | undefined>;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const refs = await loadRefs();
  const sb = await createClient();
  const LIMIT = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const from = rangeFrom(sp.range);
  const admin = isAdmin(profile);
  const deleted = admin && sp.deleted === "1";
  const untouched = sp.untouched === "1";

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
        q: sp.q, status_id: sp.status_id, sub_status_id: sp.sub_status_id, category: sp.category, owner_id: sp.owner_id, unassigned: sp.unassigned === "1", seen: sp.seen,
        open_only: sp.open === "1", product_id: sp.product_id, source_id: sp.source_id, team_id: sp.team_id, branch_id: sp.branch_id,
        number_id: sp.number_id, priority: sp.priority, ai_score: sp.ai_score, stale: sp.stale === "1", tag_id: sp.tag_id, followup: sp.followup, from, sort: sp.sort, dir: sp.dir, limit: LIMIT, offset,
        untouched, deleted: deleted ? "1" : undefined,
      },
    });
    if (e) error = e.message; else { rows = data.rows; total = data.total; }
  }

  // Saved "Customize Table" layout for this user (null until they save one, or before the SQL is applied).
  const { data: company } = await sb.from("lb_companies").select("require_next_action").eq("id", profile.company_id).maybeSingle();
  const { data: prefs } = await sb.from("lb_user_prefs").select("key,value").eq("user_id", profile.id).in("key", ["leads.table", "leads.cards", "leads.views"]);
  const pref = prefs?.find((x) => x.key === "leads.table");
  const views = ((prefs?.find((x) => x.key === "leads.views")?.value as LeadViews | undefined)?.views) ?? [];
  const cardsPref = (prefs?.find((x) => x.key === "leads.cards")?.value as LeadCardsPref | undefined) ?? null;

  // Status cards: one count per active status for the chosen period (RLS limits agents to their own leads).
  let cards: Card[] = [];
  let cardsTotal = 0;
  if (!metric && !deleted) {
    const count = (statusId?: string) => {
      let qy = sb.from("lb_leads").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id);
      if (statusId) qy = qy.eq("status_id", statusId);
      if (from) qy = qy.gte("created_at", from);
      return qy;
    };
    const active = refs.statuses.filter((s) => s.is_active || s.id === sp.status_id);
    const res = await Promise.all([count(), ...active.map((s) => count(s.id))]);
    cardsTotal = res[0].count ?? 0;
    cards = active.map((s, i) => ({ id: s.id, name: s.name, category: s.category, count: res[i + 1].count ?? 0 }));
  }
  const FILTER_KEYS = ["status_id", "sub_status_id", "owner_id", "product_id", "source_id", "team_id", "number_id", "priority", "ai_score", "tag_id", "followup", "seen", "open", "unassigned", "stale"];
  const activeFilters = FILTER_KEYS.filter((k) => sp[k]).length;

  const statusName = metric?.startsWith("status:") ? refs.statuses.find((s) => s.id === metric.slice(7))?.name : null;
  const mUser = sp.mu ? refs.users.find((u) => u.id === sp.mu)?.full_name : null;
  const preset = PRESETS.find((p) => p.value === (sp.preset || "today"))?.label;
  const qsAll = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "offset") as [string, string][]).toString();

  return (
    <>
      {metric && <PageHeader icon="target" tone="blue" title={metric ? `${statusName ? `Status: ${statusName}` : METRICS[metric]?.label ?? "Leads"}${mUser ? ` · ${mUser}` : ""}` : "Leads"}
        sub={metric ? <>{statusName ? "Current leads in this status." : METRICS[metric]?.def} {METRICS[metric]?.kind === "period" && <b>Period: {preset}.</b>} <Link className="text-brand-700 hover:underline" href={`/dashboard?${new URLSearchParams(pickFilters(sp) as Record<string, string>)}`}>Back to dashboard</Link></> : `${total} lead${total === 1 ? "" : "s"}`}
        actions={<>
          {can(profile, "leads.export") && <a className="btn-ghost" href={`/api/export/leads?${exportQs}`}><Icon name="download" />Export CSV</a>}
          <CustomizeButton />
        </>} />}

      {!metric && (
        <>
        {!deleted && <StatusCards cards={cards} total={cardsTotal} activeId={sp.status_id ?? null} range={sp.range ?? ""} pref={cardsPref}
          baseQs={qsAll} />}
        <LeadsToolbar qs={qsAll} views={views} total={total} q={sp.q} activeFilters={activeFilters} untouched={untouched} deleted={deleted}
          perm={{ create: can(profile, "leads.create"), import: can(profile, "leads.import"), export: can(profile, "leads.export"), admin }}
          exportHref={`/api/export/leads?${exportQs}`}>
          {sp.range && <input type="hidden" name="range" value={sp.range} />}
          <select className="input" name="status_id" defaultValue={sp.status_id ?? ""}><option value="">All statuses</option>{refs.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          {refs.subStatuses.length > 0 && (
            <select className="input" name="sub_status_id" defaultValue={sp.sub_status_id ?? ""}><option value="">Any sub-status</option>{refs.subStatuses.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status_id ? ` (${refs.statuses.find((x) => x.id === s.status_id)?.name ?? ""})` : ""}</option>)}</select>
          )}
          {isManager(profile) && (
            <select className="input" name="owner_id" defaultValue={sp.owner_id ?? ""}><option value="">All owners</option>{refs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.is_active ? "" : " (inactive)"}</option>)}</select>
          )}
          <select className="input" name="product_id" defaultValue={sp.product_id ?? ""}><option value="">All products</option>{refs.products.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="input" name="source_id" defaultValue={sp.source_id ?? ""}><option value="">All sources</option>{refs.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          {isManager(profile) && <select className="input" name="team_id" defaultValue={sp.team_id ?? ""}><option value="">All teams</option>{refs.teams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <select className="input" name="number_id" defaultValue={sp.number_id ?? ""}><option value="">All numbers</option>{refs.numbers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <select className="input" name="priority" defaultValue={sp.priority ?? ""}><option value="">Any priority</option><option value="high,urgent">High + urgent</option>{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select>
          <select className="input" name="ai_score" defaultValue={sp.ai_score ?? ""}><option value="">Any AI score</option><option value="hot">🔥 Hot</option><option value="hot,warm">Hot + warm</option><option value="warm">🌤️ Warm</option><option value="cold">❄️ Cold</option><option value="none">Not scored yet</option></select>
          <select className="input" name="tag_id" defaultValue={sp.tag_id ?? ""}><option value="">Any tag</option>{refs.tags.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="input" name="followup" defaultValue={sp.followup ?? ""}><option value="">Any follow-up</option><option value="today">Due today</option><option value="overdue">Overdue</option></select>
          <select className="input" name="seen" defaultValue={sp.seen ?? ""}><option value="">Seen + unseen</option><option value="unseen">Unseen by owner</option><option value="seen">Seen by owner</option></select>
          {/* Sorting is done from the column headers; keep it when filters change. */}
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
          {sp.per && <input type="hidden" name="per" value={sp.per} />}
          <div className="col-span-2 flex flex-wrap items-center gap-3 text-sm sm:col-span-1">
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-600" name="open" value="1" defaultChecked={sp.open === "1"} /> Open</label>
            {isManager(profile) && <label className="flex items-center gap-1"><input type="checkbox" className="accent-brand-600" name="unassigned" value="1" defaultChecked={sp.unassigned === "1"} /> Unassigned</label>}
            <label className="flex items-center gap-1" title="No activity for 14+ days"><input type="checkbox" className="accent-brand-600" name="stale" value="1" defaultChecked={sp.stale === "1"} /> Stale 14d+</label>
          </div>
        </LeadsToolbar>
        </>
      )}

      {error ? <ErrorBox message={error} /> : rows.length === 0 ? (
        <Empty icon="target" title="No leads found">{metric ? "Nothing matches this metric for the selected filters." : deleted ? "No deleted leads. Deleted leads show here so an admin can restore them." : "Try different filters, create a lead, or import a CSV."}</Empty>
      ) : (
        <LeadTable rows={rows} edit={{
            statuses: refs.statuses, subStatuses: refs.subStatuses, products: refs.products,
            canStatus: !deleted && can(profile, "leads.status"), canEdit: !deleted && can(profile, "leads.edit"), requireNext: company?.require_next_action ?? true,
          }} saved={(pref?.value as LeadTableLayout | undefined) ?? null} sortable={!metric} canAssign={can(profile, "leads.assign")} canDelete={admin && !metric} deletedView={deleted}
          users={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))} />
      )}
      <ChatPopupHost />
      {!error && <ListFooter total={total} per={LIMIT} offset={offset} qs={new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()} />}
    </>
  );
}

type Row = {
  id: string; lead_no: number; customer_name: string | null; phone_e164: string; status_name: string; status_category: string; sub_status_name?: string | null;
  priority: string; owner_id: string | null; owner_name: string | null; owner_seen_at?: string | null; email?: string | null; assigned_at?: string | null; converted_at?: string | null; remark?: string | null; remark_at?: string | null; product_name: string | null; source_name: string | null;
  expected_value: number | null; won_value: number | null; created_at: string; last_activity_at: string; next_followup_at: string | null;
};
