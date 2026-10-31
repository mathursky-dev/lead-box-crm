import Link from "next/link";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs, type Refs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { Icon, Kpi } from "@/components/kit";
import { istDate, istMidnight, fmtClock, money } from "@/lib/dates";
import { RANGES, analyticsRange, fetchAll, dayLabel, shiftDay, SERIES_COLORS, OTHER_COLOR } from "@/lib/analytics";
import { Funnel, HBars, Donut, Trend, type Slice, type Series } from "./charts";
import { ParamSelect, RangePicker, RefreshButton, MultiPick } from "./controls";
import { Box, Toggle, NoData, SumCard } from "./ui";

export const metadata = { title: "Analytics" };

type SP = Record<string, string | undefined>;
type LeadRow = { id: string; status_id: string | null; source_id: string | null; owner_id: string | null; status_category: string | null; expected_value: number | null; won_value: number | null; created_at: string };
type EventRow = { type: string; actor_id: string | null; lead_id: string; created_at: string };
type MsgRow = { direction: string; status: string; automated: boolean | null; campaign_id: string | null; journey_id: string | null; sent_by: string | null; created_at: string };
type TaskRow = { id: string; due_at: string; note: string | null; action_type: string | null; assigned_to: string | null; lead: { id: string; lead_no: number; customer: { name: string | null; phone_e164: string } | null } | null };

const nf = new Intl.NumberFormat("en-IN");
const inr = (v: number) => money(Math.round(v));
const TABS = [["leads", "Leads", "contacts"], ["marketing", "Marketing", "send"], ["activity", "Activity", "bolt"]] as const;
const MUTED = ["#94a3b8", "#64748b", "#cbd5e1", "#475569", "#a8b3c4", "#7c8799"];
const istDay = (iso: string) => istDate(new Date(iso));

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const manager = isManager(profile);
  const refs = await loadRefs();
  const sb = await createClient();
  const cid = profile.company_id; // super_admin RLS reads every company, so always pin the company.
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "leads";
  const r = analyticsRange(sp.range, sp.from, sp.to);
  const from = r.from.toISOString(), to = r.to.toISOString();

  // Whose numbers: agents see only their own; admins / team leaders pick "My team" (default), "Only me" or one person.
  const { data: visibleIds } = await sb.rpc("lb_visible_user_ids");
  const visible = new Set((visibleIds ?? []) as string[]);
  const people = refs.users.filter((u) => visible.has(u.id) && u.id !== profile.id && u.is_active);
  let scope = manager ? sp.scope || "team" : "me";
  if (scope !== "team" && scope !== "me" && !people.some((u) => u.id === scope)) scope = manager ? "team" : "me";
  const who: string | null = scope === "team" ? null : scope === "me" ? profile.id : scope;
  const whoName = scope === "team" ? (profile.role === "team_leader" ? "My team" : "Whole company") : scope === "me" ? "Only me" : refs.users.find((u) => u.id === scope)?.full_name ?? "";

  const qs = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(patch)) if (v) q.set(k, v); else q.delete(k);
    return `/analytics?${q.toString()}`;
  };

  // Today-tasks panel (any tab): pending follow-ups due on the chosen day.
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : istDate();
  const d0 = istMidnight(day), d1 = new Date(d0.getTime() + 86400000);
  let tq = sb.from("lb_followups").select("id,due_at,note,action_type,assigned_to,lead:lb_leads(id,lead_no,customer:lb_customers(name,phone_e164))")
    .eq("company_id", cid).eq("status", "pending").gte("due_at", d0.toISOString()).lt("due_at", d1.toISOString()).order("due_at").limit(100);
  let oq = sb.from("lb_followups").select("id", { count: "exact", head: true }).eq("company_id", cid).eq("status", "pending").lt("due_at", istMidnight(istDate()).toISOString());
  if (who) { tq = tq.eq("assigned_to", who); oq = oq.eq("assigned_to", who); }
  const [{ data: tasks }, { count: overdue }] = await Promise.all([tq, oq]);

  const header = (
    <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 p-2">
      <nav className="flex flex-wrap gap-1" aria-label="Analytics sections">
        {TABS.map(([t, label, icon]) => (
          <Link key={t} href={qs({ tab: t })} aria-current={tab === t ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-navy-900"}`}>
            <Icon name={icon} className="h-4 w-4" />{label}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-1.5">
        {manager ? (
          <ParamSelect param="scope" value={scope} label="Whose data" icon="user" options={[
            { value: "team", label: profile.role === "team_leader" ? "My team" : "Whole company" }, { value: "me", label: "My dashboard" },
            ...people.map((u) => ({ value: u.id, label: u.full_name })),
          ]} />
        ) : <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 shadow-sm">My Dashboard</span>}
        <RangePicker value={r.key} from={r.fromYmd} to={r.toYmd} options={RANGES.map((x) => ({ value: x.value, label: x.label }))} />
        <RefreshButton />
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (tab === "marketing") body = await MarketingTab({ sb, cid, from, to, days: r.days, refs, canCampaigns: can(profile, "campaigns.manage") || can(profile, "campaigns.approve") });
  else if (tab === "activity") body = await ActivityTab({ sb, cid, from, to, days: r.days, who, refs, showPeople: manager && scope === "team" });
  else body = await LeadsTab({ sb, cid, from, to, days: r.days, who, refs, sp, qs });

  const rangeText = r.fromYmd === r.toYmd ? dayLabel(r.fromYmd) : `${dayLabel(r.fromYmd)} – ${dayLabel(r.toYmd)}`;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-navy-900">Analytics</h1>
        <p className="text-xs text-slate-500">{whoName} · {rangeText} (IST)</p>
      </div>
      {header}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">{body}</div>
        <TasksPanel day={day} tasks={(tasks ?? []) as unknown as TaskRow[]} overdue={overdue ?? 0} qs={qs} refs={refs} showOwner={who === null} />
      </div>
    </>
  );
}

type Sb = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ Leads */

async function LeadsTab({ sb, cid, from, to, days, who, refs, sp, qs }: { sb: Sb; cid: string; from: string; to: string; days: string[]; who: string | null; refs: Refs; sp: SP; qs: (p: Record<string, string | null>) => string }) {
  const [leads, events] = await Promise.all([
    fetchAll<LeadRow>((a, b) => {
      let q = sb.from("lb_leads").select("id,status_id,source_id,owner_id,status_category,expected_value,won_value,created_at").eq("company_id", cid).gte("created_at", from).lt("created_at", to);
      if (who) q = q.eq("owner_id", who);
      return q.order("created_at").range(a, b);
    }),
    fetchAll<EventRow>((a, b) => {
      let q = sb.from("lb_lead_events").select("type,actor_id,lead_id,created_at").eq("company_id", cid).eq("type", "call").gte("created_at", from).lt("created_at", to);
      if (who) q = q.eq("actor_id", who);
      return q.order("created_at").range(a, b);
    }),
  ]);
  const rows = leads.rows, calls = events.rows;
  const total = rows.length;
  const ownerQ = who ? `&owner_id=${who}` : "";

  // Statuses keep one colour each, by their position in the company's status list.
  const statusColor = new Map<string, string>();
  refs.statuses.forEach((s, i) => statusColor.set(s.id, i < SERIES_COLORS.length ? SERIES_COLORS[i] : MUTED[(i - SERIES_COLORS.length) % MUTED.length]));
  const byStatus = new Map<string, LeadRow[]>();
  for (const l of rows) { const k = l.status_id ?? "none"; byStatus.set(k, [...(byStatus.get(k) ?? []), l]); }
  const statusSlices: Slice[] = refs.statuses.filter((s) => byStatus.has(s.id)).map((s) => ({ key: s.id, label: s.name, value: byStatus.get(s.id)!.length, color: statusColor.get(s.id)!, href: `/leads?status_id=${s.id}${ownerQ}` }));
  if (byStatus.has("none")) statusSlices.push({ key: "none", label: "No status", value: byStatus.get("none")!.length, color: OTHER_COLOR });
  const ranked = [...statusSlices].sort((a, b) => b.value - a.value);
  const sum = (ls: LeadRow[] | undefined, f: (l: LeadRow) => number) => (ls ?? []).reduce((n, l) => n + f(l), 0);
  const potential = (l: LeadRow) => Number(l.expected_value ?? 0);
  const actual = (l: LeadRow) => (l.status_category === "won" ? Number(l.won_value ?? l.expected_value ?? 0) : 0);

  // Summary
  const view = ["status", "calls", "sources"].includes(sp.sum ?? "") ? sp.sum! : "status";
  const defaultPick = refs.statuses.filter((s) => ["follow_up", "scheduled", "interested"].includes(s.category) && byStatus.has(s.id)).map((s) => s.id);
  const picked = sp.st ? sp.st.split(",").filter((id) => refs.statuses.some((s) => s.id === id)) : defaultPick.length ? defaultPick : ranked.slice(0, 3).map((s) => s.key).filter((k) => k !== "none");
  const usedSources = new Map<string, LeadRow[]>();
  for (const l of rows) { const k = l.source_id ?? "none"; usedSources.set(k, [...(usedSources.get(k) ?? []), l]); }
  const calledLeads = new Set(calls.map((c) => c.lead_id)).size;
  const callers = new Map<string, number>();
  for (const c of calls) if (c.actor_id) callers.set(c.actor_id, (callers.get(c.actor_id) ?? 0) + 1);
  const userName = (id: string) => refs.users.find((u) => u.id === id)?.full_name ?? "Unknown";

  const summaryNav = [
    { k: "status", icon: "contacts", title: "Lead status", sub: `${nf.format(total)} leads` },
    { k: "calls", icon: "phone", title: "Calls", sub: `${nf.format(calls.length)} calls` },
    { k: "sources", icon: "globe", title: "Sources", sub: `${nf.format(total)} leads` },
  ];
  let cards: React.ReactNode;
  if (view === "calls") {
    cards = calls.length ? <>
      <SumCard title="Calls made" icon="phone" value={nf.format(calls.length)} foot={[{ label: "Leads called", value: nf.format(calledLeads) }, { label: "Per day", value: (calls.length / days.length).toFixed(1) }]} />
      {[...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => <SumCard key={id} title={userName(id)} icon="user" value={nf.format(n)} foot={[{ label: "Share", value: `${Math.round((n / calls.length) * 100)}%` }]} />)}
    </> : <div className="grid flex-1 place-items-center py-6 text-sm text-slate-400">No calls logged in this period. Calls logged on a lead show up here.</div>;
  } else if (view === "sources") {
    const list = [...usedSources.entries()].sort((a, b) => b[1].length - a[1].length);
    cards = list.length ? list.slice(0, 6).map(([id, ls]) => (
      <SumCard key={id} title={id === "none" ? "Others (no source)" : refs.sources.find((s) => s.id === id)?.name ?? "Unknown"} icon="globe" value={nf.format(ls.length)}
        href={id === "none" ? undefined : `/leads?source_id=${id}${ownerQ}`} foot={[{ label: "Potential", value: inr(sum(ls, potential)) }, { label: "Actual", value: inr(sum(ls, actual)) }]} />
    )) : <div className="grid flex-1 place-items-center py-6 text-sm text-slate-400">No leads in this period.</div>;
  } else {
    cards = picked.length ? picked.map((id) => {
      const s = refs.statuses.find((x) => x.id === id)!;
      const ls = byStatus.get(id);
      return <SumCard key={id} title={s.name} icon={s.category === "won" ? "trophy" : s.category === "follow_up" ? "calendar" : "target"} value={nf.format(ls?.length ?? 0)} href={`/leads?status_id=${id}${ownerQ}`}
        foot={[{ label: "Potential", value: inr(sum(ls, potential)) }, { label: "Actual", value: inr(sum(ls, actual)) }]} />;
    }) : <div className="grid flex-1 place-items-center py-6 text-sm text-slate-400">Pick statuses to show from the list on the right.</div>;
  }

  // Funnel headline
  const top = ranked[0], next = ranked.slice(1, 3);
  const funnelHead = total ? <><b className="text-sm text-navy-900">{nf.format(total)} leads</b> · <b>{Math.round((top.value / total) * 100)}%</b> are <b className="uppercase">{top.label}</b>{next.length > 0 && <> · next {next.map((n, i) => <span key={n.key}>{i ? " · " : ""}<b>{n.label}</b> {n.value}</span>)}</>}</> : null;

  // Trend: leads created per day, one series per status (first 8 statuses keep their colour, the rest fold into Other).
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const series = new Map<string, Series>();
  refs.statuses.forEach((s, i) => { if (byStatus.has(s.id)) series.set(i < SERIES_COLORS.length ? s.id : "other", series.get(i < SERIES_COLORS.length ? s.id : "other") ?? { key: i < SERIES_COLORS.length ? s.id : "other", name: i < SERIES_COLORS.length ? s.name : "Other", color: i < SERIES_COLORS.length ? SERIES_COLORS[i] : OTHER_COLOR, values: days.map(() => 0) }); });
  if (byStatus.has("none")) series.set("other", series.get("other") ?? { key: "other", name: "Other", color: OTHER_COLOR, values: days.map(() => 0) });
  const perDay = days.map(() => 0);
  for (const l of rows) {
    const i = dayIdx.get(istDay(l.created_at)); if (i === undefined) continue;
    perDay[i]++;
    const idx = refs.statuses.findIndex((s) => s.id === l.status_id);
    const key = idx >= 0 && idx < SERIES_COLORS.length ? l.status_id! : "other";
    series.get(key)!.values[i]++;
  }
  const trendSeries = [...series.values()].sort((a, b) => (a.key === "other" ? 1 : b.key === "other" ? -1 : 0));
  const busiest = perDay.reduce((bi, v, i) => (v > perDay[bi] ? i : bi), 0);
  const trendHead = total ? <><b className="text-sm text-navy-900">{nf.format(total)} leads</b> · Busiest day <b>{dayLabel(days[busiest])}</b> ({perDay[busiest]}) · most common <b className="uppercase">{top.label}</b></> : null;

  // Opportunity funnel: money by status for leads with a value.
  const opp: Slice[] = refs.statuses.map((s) => ({ key: s.id, label: s.name, color: statusColor.get(s.id)!, href: `/leads?status_id=${s.id}${ownerQ}`, value: sum(byStatus.get(s.id), (l) => (l.status_category === "won" ? actual(l) : potential(l))) })).filter((s) => s.value > 0);
  const oppTotal = opp.reduce((n, s) => n + s.value, 0);
  const wonTotal = sum(rows, actual);
  const oppHead = oppTotal ? <><b className="text-sm text-navy-900">{inr(oppTotal)}</b> in {nf.format(rows.filter((l) => potential(l) || actual(l)).length)} leads with a value · won <b>{inr(wonTotal)}</b></> : null;

  // Sources donut
  const srcSlices: Slice[] = refs.sources.map((s, i) => ({ s, i })).filter(({ s }) => usedSources.has(s.id)).map(({ s, i }) => ({ key: s.id, label: s.name, value: usedSources.get(s.id)!.length, color: SERIES_COLORS[i % SERIES_COLORS.length], href: `/leads?source_id=${s.id}${ownerQ}` }));
  if (usedSources.has("none")) srcSlices.unshift({ key: "none", label: "Others", value: usedSources.get("none")!.length, color: OTHER_COLOR });
  const srcRanked = [...srcSlices].filter((s) => s.key !== "none").sort((a, b) => b.value - a.value);
  const noSrc = usedSources.get("none")?.length ?? 0;
  const srcHead = total ? <><b className="text-sm text-navy-900">{nf.format(total)} leads</b> · <b>{((noSrc / total) * 100).toFixed(noSrc && noSrc / total < 0.1 ? 1 : 0)}%</b> have no source set (Others){srcRanked[0] && <> · top source <b>{srcRanked[0].label}</b> ({Math.round((srcRanked[0].value / total) * 100)}%){srcRanked[1] && <>, then <b>{srcRanked[1].label}</b></>}</>}</> : null;

  const fv = sp.fv === "bars" ? "bars" : "funnel", tv = sp.tv === "line" || sp.tv === "bar" ? sp.tv : "area", ov = sp.ov === "bars" ? "bars" : "funnel", sv = sp.sv === "bars" ? "bars" : "donut";
  const funnelOpts = [{ value: "funnel", label: "Funnel", icon: "filter" }, { value: "bars", label: "Bars", icon: "list" }];
  const err = leads.error ?? events.error;

  return (
    <>
      {err && <ErrorBox message={err} />}
      <Box title="Summary" actions={view === "status" ? <MultiPick param="st" selected={picked} placeholder="Pick statuses" options={refs.statuses.filter((s) => s.is_active || byStatus.has(s.id)).map((s) => ({ value: s.id, label: s.name }))} /> : undefined}>
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="flex shrink-0 gap-2 md:w-52 md:flex-col">
            {summaryNav.map((n) => (
              <Link key={n.k} href={qs({ sum: n.k === "status" ? null : n.k })} scroll={false} aria-current={view === n.k ? "true" : undefined}
                className={`flex flex-1 items-center gap-2.5 rounded-xl border px-3 py-2 transition md:flex-none ${view === n.k ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-brand-600 shadow-sm"><Icon name={n.icon} className="h-3.5 w-3.5" /></span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-navy-900">{n.title}</span><span className="block text-[11px] text-slate-500">{n.sub}</span></span>
              </Link>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-3">{cards}</div>
        </div>
      </Box>

      <div className="grid gap-4 lg:grid-cols-2">
        <Box title="Lead Funnel" headline={funnelHead} actions={<Toggle options={funnelOpts} value={fv} href={(v) => qs({ fv: v === "funnel" ? null : v })} />}>
          {!total ? <NoData /> : fv === "bars" ? <HBars rows={statusSlices} /> : <Funnel rows={statusSlices} />}
        </Box>
        <Box title="Lead Trend" headline={trendHead} actions={<Toggle options={[{ value: "area", label: "Area", icon: "chart" }, { value: "line", label: "Line" }, { value: "bar", label: "Bars" }]} value={tv} href={(v) => qs({ tv: v === "area" ? null : v })} />}>
          {!total ? <NoData /> : <Trend labels={days.map(dayLabel)} series={trendSeries} mode={tv as "area" | "line" | "bar"} />}
        </Box>
        <Box title="Opportunity Funnel" headline={oppHead} actions={<Toggle options={funnelOpts} value={ov} href={(v) => qs({ ov: v === "funnel" ? null : v })} />}>
          {!opp.length ? <NoData>No data for this period<br /><span className="text-xs">Add an expected value on leads to see the money in each stage.</span></NoData> : ov === "bars" ? <HBars rows={opp} format={inr} /> : <Funnel rows={opp} format={inr} />}
        </Box>
        <Box title="Lead Source" headline={srcHead} actions={<Toggle options={[{ value: "donut", label: "Donut", icon: "overview" }, { value: "bars", label: "Bars", icon: "list" }]} value={sv} href={(v) => qs({ sv: v === "donut" ? null : v })} />}>
          {!total ? <NoData /> : sv === "bars" ? <HBars rows={srcSlices} /> : <Donut rows={srcSlices} center={nf.format(total)} centerSub="leads" />}
        </Box>
      </div>
      <p className="text-xs text-slate-500">Counts are leads created in the selected period, shown by their current status. Potential = expected value; Actual = won value of Won leads. Clicking a status or source opens the lead list for it.</p>
    </>
  );
}

/* -------------------------------------------------------------- Marketing */

async function MarketingTab({ sb, cid, from, to, days, refs, canCampaigns }: { sb: Sb; cid: string; from: string; to: string; days: string[]; refs: Refs; canCampaigns: boolean }) {
  const [msgs, leads, camps] = await Promise.all([
    fetchAll<MsgRow>((a, b) => sb.from("lb_messages").select("direction,status,automated,campaign_id,journey_id,sent_by,created_at").eq("company_id", cid).gte("created_at", from).lt("created_at", to).order("created_at").range(a, b), 50000),
    fetchAll<{ source_id: string | null; created_at: string }>((a, b) => sb.from("lb_leads").select("source_id,created_at").eq("company_id", cid).gte("created_at", from).lt("created_at", to).order("created_at").range(a, b)),
    canCampaigns
      ? sb.from("lb_campaigns").select("id,name,status,launched_at,created_at,template_name").eq("company_id", cid).or(`and(launched_at.gte.${from},launched_at.lt.${to}),and(created_at.gte.${from},created_at.lt.${to})`).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as { id: string; name: string; status: string; launched_at: string | null; created_at: string; template_name: string | null }[], error: null }),
  ]);
  const m = msgs.rows;
  const out = m.filter((x) => x.direction === "out"), inn = m.filter((x) => x.direction === "in");
  const failed = out.filter((x) => x.status === "failed").length;
  const sent = out.filter((x) => ["sent", "delivered", "read"].includes(x.status)).length;
  const delivered = out.filter((x) => ["delivered", "read"].includes(x.status)).length;
  const read = out.filter((x) => x.status === "read").length;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const mk = (key: string, name: string, color: string): Series => ({ key, name, color, values: days.map(() => 0) });
  const sS = mk("out", "Sent", SERIES_COLORS[0]), rS = mk("in", "Received", SERIES_COLORS[2]), fS = mk("failed", "Failed", SERIES_COLORS[7]);
  for (const x of m) {
    const i = dayIdx.get(istDay(x.created_at)); if (i === undefined) continue;
    if (x.direction === "in") rS.values[i]++; else if (x.status === "failed") fS.values[i]++; else sS.values[i]++;
  }

  const origin: Slice[] = [
    { key: "agent", label: "Typed by agents", value: out.filter((x) => !x.automated && !x.campaign_id && !x.journey_id).length, color: SERIES_COLORS[0] },
    { key: "bot", label: "Chatbots & auto-replies", value: out.filter((x) => x.automated && !x.campaign_id && !x.journey_id).length, color: SERIES_COLORS[1] },
    { key: "journey", label: "Journeys", value: out.filter((x) => x.journey_id && !x.campaign_id).length, color: SERIES_COLORS[2] },
    { key: "campaign", label: "Campaigns", value: out.filter((x) => x.campaign_id).length, color: SERIES_COLORS[3] },
  ].filter((s) => s.value > 0);

  const delivery: Slice[] = [
    { key: "queued", label: "Sent to WhatsApp", value: out.length - failed, color: SERIES_COLORS[0] },
    { key: "delivered", label: "Delivered", value: delivered, color: SERIES_COLORS[2] },
    { key: "read", label: "Read", value: read, color: SERIES_COLORS[6] },
  ];

  const srcCount = new Map<string, number>();
  for (const l of leads.rows) srcCount.set(l.source_id ?? "none", (srcCount.get(l.source_id ?? "none") ?? 0) + 1);
  const srcRows: Slice[] = refs.sources.map((s, i) => ({ s, i })).filter(({ s }) => srcCount.has(s.id)).map(({ s, i }) => ({ key: s.id, label: s.name, value: srcCount.get(s.id)!, color: SERIES_COLORS[i % SERIES_COLORS.length], href: `/leads?source_id=${s.id}` }));
  if (srcCount.has("none")) srcRows.push({ key: "none", label: "Others", value: srcCount.get("none")!, color: OTHER_COLOR });
  srcRows.sort((a, b) => b.value - a.value);

  const campaigns = (camps.data ?? []) as { id: string; name: string; status: string; launched_at: string | null; created_at: string; template_name: string | null }[];
  const recip = new Map<string, Record<string, number>>();
  if (campaigns.length) {
    const { rows } = await fetchAll<{ campaign_id: string; status: string }>((a, b) => sb.from("lb_campaign_recipients").select("campaign_id,status").eq("company_id", cid).in("campaign_id", campaigns.map((c) => c.id)).range(a, b));
    for (const x of rows) { const o = recip.get(x.campaign_id) ?? {}; o[x.status] = (o[x.status] ?? 0) + 1; recip.set(x.campaign_id, o); }
  }
  const err = msgs.error ?? leads.error ?? camps.error?.message;

  return (
    <>
      {err && <ErrorBox message={err} />}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Messages sent" icon="send" tone="green" value={nf.format(sent)} sub={`${nf.format(out.length)} attempted`} />
        <Kpi label="Delivered" icon="check" tone="blue" value={pct(delivered, out.length - failed)} sub={`${nf.format(delivered)} messages`} />
        <Kpi label="Read" icon="overview" tone="violet" value={pct(read, delivered)} sub={`${nf.format(read)} of delivered`} />
        <Kpi label="Failed" icon="alert" tone="red" value={nf.format(failed)} sub={pct(failed, out.length) + " of attempted"} />
        <Kpi label="Received" icon="inbox" tone="amber" value={nf.format(inn.length)} sub="Customer messages" />
        <Kpi label="New leads" icon="userPlus" tone="orange" value={nf.format(leads.rows.length)} sub="Created in period" />
      </section>
      <Box title="WhatsApp Messages" headline={m.length ? <><b className="text-sm text-navy-900">{nf.format(m.length)} messages</b> · {nf.format(out.length)} out · {nf.format(inn.length)} in</> : null}>
        {!m.length ? <NoData /> : <Trend labels={days.map(dayLabel)} series={[sS, rS, fS]} mode="area" />}
      </Box>
      <div className="grid gap-4 lg:grid-cols-2">
        <Box title="Delivery Funnel" headline={out.length ? <>Of <b>{nf.format(out.length - failed)}</b> messages sent, <b>{pct(read, out.length - failed)}</b> were read</> : null}>
          {!out.length ? <NoData /> : <Funnel rows={delivery} />}
        </Box>
        <Box title="Who Sent It" headline={out.length ? <>Where outgoing messages came from</> : null}>
          {!origin.length ? <NoData /> : <Donut rows={origin} center={nf.format(out.length)} centerSub="sent" />}
        </Box>
        <Box title="Leads by Source" className="lg:col-span-2">
          {!srcRows.length ? <NoData /> : <HBars rows={srcRows} />}
        </Box>
      </div>
      {canCampaigns && (
        <Box title="Campaigns" actions={<Link href="/nurture/campaigns" className="text-xs font-semibold text-brand-700 hover:underline">All campaigns ↗</Link>}>
          {!campaigns.length ? <NoData>No campaigns created or launched in this period</NoData> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr>{["Campaign", "Status", "Recipients", "Sent", "Failed / skipped"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {campaigns.map((c) => {
                    const o = recip.get(c.id) ?? {};
                    const all = Object.values(o).reduce((a, b) => a + b, 0);
                    const bad = Object.entries(o).filter(([k]) => /fail|skip|suppress|error/.test(k)).reduce((a, [, v]) => a + v, 0);
                    const ok = Object.entries(o).filter(([k]) => /sent|deliver|read/.test(k)).reduce((a, [, v]) => a + v, 0);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="td"><Link href={`/nurture/campaigns/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name}</Link>{c.template_name && <div className="text-xs text-slate-500">{c.template_name}</div>}</td>
                        <td className="td capitalize">{c.status.replace(/_/g, " ")}</td>
                        <td className="td">{nf.format(all)}</td><td className="td">{nf.format(ok)}</td><td className="td">{nf.format(bad)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Box>
      )}
      <p className="text-xs text-slate-500">Marketing shows every WhatsApp conversation you are allowed to see, for the selected period.</p>
    </>
  );
}

/* --------------------------------------------------------------- Activity */

const ACT: { type: string; label: string; icon: string; tone: string }[] = [
  { type: "call", label: "Calls", icon: "phone", tone: "green" },
  { type: "message_out", label: "Messages sent", icon: "send", tone: "blue" },
  { type: "note", label: "Notes", icon: "template", tone: "violet" },
  { type: "status_change", label: "Status changes", icon: "flow", tone: "amber" },
  { type: "followup_created", label: "Follow-ups set", icon: "calendar", tone: "orange" },
  { type: "followup_done", label: "Follow-ups done", icon: "check", tone: "green" },
  { type: "assignment", label: "Assignments", icon: "userPlus", tone: "slate" },
  { type: "field_update", label: "Lead edits", icon: "sliders", tone: "slate" },
];

async function ActivityTab({ sb, cid, from, to, days, who, refs, showPeople }: { sb: Sb; cid: string; from: string; to: string; days: string[]; who: string | null; refs: Refs; showPeople: boolean }) {
  const ev = await fetchAll<EventRow>((a, b) => {
    let q = sb.from("lb_lead_events").select("type,actor_id,lead_id,created_at").eq("company_id", cid).in("type", ACT.map((x) => x.type)).gte("created_at", from).lt("created_at", to);
    if (who) q = q.eq("actor_id", who);
    return q.order("created_at").range(a, b);
  }, 50000);
  const rows = ev.rows;
  const count = (t: string) => rows.filter((r) => r.type === t).length;
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const series: Series[] = ACT.slice(0, 8).map((a, i) => ({ key: a.type, name: a.label, color: SERIES_COLORS[i], values: days.map(() => 0) }));
  const sIdx = new Map(series.map((s, i) => [s.key, i]));
  for (const r of rows) { const i = dayIdx.get(istDay(r.created_at)); const j = sIdx.get(r.type); if (i !== undefined && j !== undefined) series[j].values[i]++; }
  const used = series.filter((s) => s.values.some(Boolean));
  const leadsTouched = new Set(rows.map((r) => r.lead_id)).size;
  const perDay = days.map((_, i) => series.reduce((n, s) => n + s.values[i], 0));
  const busiest = perDay.reduce((bi, v, i) => (v > perDay[bi] ? i : bi), 0);

  const byUser = new Map<string, Record<string, number>>();
  for (const r of rows) { if (!r.actor_id) continue; const o = byUser.get(r.actor_id) ?? {}; o[r.type] = (o[r.type] ?? 0) + 1; byUser.set(r.actor_id, o); }
  const people = [...byUser.entries()].map(([id, o]) => ({ id, o, total: Object.values(o).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);

  return (
    <>
      {ev.error && <ErrorBox message={ev.error} />}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ACT.map((a) => <Kpi key={a.type} label={a.label} icon={a.icon} tone={a.tone} value={nf.format(count(a.type))} />)}
      </section>
      <Box title="Activity Trend" headline={rows.length ? <><b className="text-sm text-navy-900">{nf.format(rows.length)} actions</b> on {nf.format(leadsTouched)} leads · busiest day <b>{dayLabel(days[busiest])}</b> ({perDay[busiest]})</> : null}>
        {!used.length ? <NoData /> : <Trend labels={days.map(dayLabel)} series={used} mode="bar" />}
      </Box>
      {showPeople && (
        <Box title="Team Activity">
          {!people.length ? <NoData /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50"><tr><th className="th">User</th>{ACT.map((a) => <th key={a.type} className="th">{a.label}</th>)}<th className="th">Total</th></tr></thead>
                <tbody className="divide-y">
                  {people.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="td whitespace-nowrap font-medium text-navy-900">{refs.users.find((u) => u.id === p.id)?.full_name ?? "Unknown"}</td>
                      {ACT.map((a) => <td key={a.type} className="td tabular-nums">{p.o[a.type] ?? 0}</td>)}
                      <td className="td font-semibold tabular-nums text-navy-900">{p.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Box>
      )}
      <p className="text-xs text-slate-500">Actions recorded on leads in the selected period, credited to the person who did them. Incoming customer messages are not counted.</p>
    </>
  );
}

/* ------------------------------------------------------------------ Tasks */

function TasksPanel({ day, tasks, overdue, qs, refs, showOwner }: { day: string; tasks: TaskRow[]; overdue: number; qs: (p: Record<string, string | null>) => string; refs: Refs; showOwner: boolean }) {
  const today = istDate();
  const label = day === today ? "Today" : day === shiftDay(today, 1) ? "Tomorrow" : day === shiftDay(today, -1) ? "Yesterday" : dayLabel(day);
  const arrow = (d: string, icon: string, aria: string) => (
    <Link href={qs({ day: d === today ? null : d })} scroll={false} aria-label={aria} className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-navy-900 shadow-sm hover:bg-slate-50">
      <Icon name={icon} className="h-4 w-4" />
    </Link>
  );
  return (
    <aside className="card h-fit overflow-hidden xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 p-3">
        {arrow(shiftDay(day, -1), "chevronLeft", "Previous day")}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-4 py-1.5 text-sm font-semibold text-brand-700"><Icon name="calendar" className="h-4 w-4" />{label}</span>
        {arrow(shiftDay(day, 1), "chevronRight", "Next day")}
      </div>
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2.5">
        <Link href="/followups" className="inline-flex items-center gap-1 text-sm font-semibold text-navy-900 hover:text-brand-700">Tasks <Icon name="link" className="h-3.5 w-3.5" /></Link>
        <span className="text-xs text-slate-500">{tasks.length} due</span>
      </div>
      {overdue > 0 && (
        <Link href="/followups?tab=overdue" className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
          <Icon name="alert" className="h-3.5 w-3.5" />{overdue} overdue follow-up{overdue === 1 ? "" : "s"}
        </Link>
      )}
      {!tasks.length ? <div className="px-4 py-10 text-center text-sm text-slate-400">No Tasks Available</div> : (
        <ul className="max-h-[70vh] divide-y overflow-y-auto">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link href={t.lead ? `/leads/${t.lead.id}` : "/followups"} className="flex gap-3 px-3 py-2.5 hover:bg-slate-50">
                <span className="w-12 shrink-0 pt-0.5 text-xs font-semibold text-brand-700">{fmtClock(t.due_at)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-navy-900">{t.lead?.customer?.name ?? t.lead?.customer?.phone_e164 ?? "Lead"} {t.lead && <span className="text-xs font-normal text-slate-400">LB-{t.lead.lead_no}</span>}</span>
                  <span className="block truncate text-xs text-slate-500"><span className="capitalize">{(t.action_type ?? "follow-up").replace(/_/g, " ")}</span>{t.note ? ` · ${t.note}` : ""}</span>
                  {showOwner && t.assigned_to && <span className="block text-[11px] text-slate-400">{refs.users.find((u) => u.id === t.assigned_to)?.full_name}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
