import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ErrorBox, PageHeader } from "@/components/static";
import { Kpi, Notice, Panel, PillTabs, Table } from "@/components/kit";
import { istDate, istMidnight } from "@/lib/dates";
import { inr } from "@/lib/quotes";
import { CommissionList, RatesTable, SettingsForm, BackfillForm, type CRow } from "./ui";

export const metadata = { title: "Commissions" };

const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const STATUSES = ["pending", "approved", "paid", "cancelled"] as const;

type SP = { month?: string; agent?: string; status?: string; tab?: string };

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const admin = isAdmin(profile);
  const tab = admin && sp.tab === "settings" ? "settings" : "list";
  const now = istDate().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") && sp.month! <= now ? sp.month! : now;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status! : "";
  const agent = /^[0-9a-f-]{36}$/i.test(sp.agent ?? "") ? sp.agent! : "";
  const db = createAdminClient();
  const [{ data: settings }, { data: people }] = await Promise.all([
    db.from("lb_commission_settings").select("*").eq("company_id", profile.company_id).maybeSingle(),
    db.from("lb_profiles").select("id,full_name,role,is_active").eq("company_id", profile.company_id).order("full_name"),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const href = (p: Partial<SP>) => `/commissions?${new URLSearchParams(Object.entries({ month, agent, status, ...p }).filter(([, v]) => v) as [string, string][])}`;
  const tabs = admin ? <PillTabs label="Commissions" tabs={[
    { href: href({ tab: "" }), label: "Commissions", icon: "rupee", active: tab === "list" },
    { href: "/commissions?tab=settings", label: "Rates & settings", icon: "gear", active: tab === "settings" },
  ]} /> : null;

  if (tab === "settings") {
    const { data: rates } = await db.from("lb_commission_rates").select("user_id,pct,flat").eq("company_id", profile.company_id);
    const rmap = new Map((rates ?? []).map((r) => [r.user_id, r]));
    return (
      <>
        <PageHeader icon="percent" tone="amber" title="Commissions" sub="Set how much agents earn on every won deal." />
        {tabs}
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Company default" icon="gear">
            <SettingsForm enabled={Boolean(settings?.enabled)} pct={Number(settings?.default_pct ?? 0)} flat={Number(settings?.flat_per_deal ?? 0)} />
          </Panel>
          <Panel title="Add commission for past deals" icon="refresh">
            <BackfillForm defaultFrom={`${now}-01`} />
          </Panel>
        </div>
        <Panel className="mt-4" title="Per-agent rate" icon="user" sub="Leave empty to use the company default.">
          <RatesTable rows={(people ?? []).filter((p) => p.is_active).map((p) => ({
            id: p.id, name: p.full_name as string, role: p.role as string,
            pct: rmap.get(p.id)?.pct == null ? "" : String(rmap.get(p.id)!.pct), flat: rmap.get(p.id)?.flat == null ? "" : String(rmap.get(p.id)!.flat),
          }))} defaultPct={Number(settings?.default_pct ?? 0)} defaultFlat={Number(settings?.flat_per_deal ?? 0)} />
        </Panel>
      </>
    );
  }

  const start = istMidnight(`${month}-01`).toISOString(), end = istMidnight(`${shift(month, 1)}-01`).toISOString();
  let q = (await createClient()).from("lb_commissions")
    .select("id,lead_id,user_id,deal_value,pct,flat,amount,status,manual,note,won_at,paid_at,paid_ref,lead:lb_leads(lead_no,customer:lb_customers(name,phone_e164))")
    .eq("company_id", profile.company_id).gte("won_at", start).lt("won_at", end).order("won_at", { ascending: false }).limit(2000);
  if (agent) q = q.eq("user_id", agent);
  const { data, error } = await q;
  if (error) return <><PageHeader icon="percent" title="Commissions" /><ErrorBox message={`Commissions are not set up yet (database update pending). ${error.message}`} /></>;
  const all: CRow[] = (data ?? []).map((r) => {
    const l = r.lead as unknown as { lead_no: number; customer: { name: string | null; phone_e164: string } | null } | null;
    return { id: r.id, lead_id: r.lead_id, lead_no: l?.lead_no ?? 0, customer: l?.customer?.name || l?.customer?.phone_e164 || "", user_id: r.user_id,
      agent: names.get(r.user_id) ?? "—", deal_value: Number(r.deal_value), pct: Number(r.pct), flat: Number(r.flat), amount: Number(r.amount),
      status: r.status, manual: r.manual, note: r.note, won_at: r.won_at, paid_at: r.paid_at, paid_ref: r.paid_ref };
  });
  const rows = status ? all.filter((r) => r.status === status) : all;
  const sum = (st?: string) => all.filter((r) => (st ? r.status === st : r.status !== "cancelled")).reduce((s, r) => s + r.amount, 0);
  const byAgent = new Map<string, { name: string; deals: number; value: number; pending: number; approved: number; paid: number }>();
  for (const r of all) {
    if (r.status === "cancelled") continue;
    const a = byAgent.get(r.user_id) ?? { name: r.agent, deals: 0, value: 0, pending: 0, approved: 0, paid: 0 };
    a.deals++; a.value += r.deal_value; a[r.status as "pending" | "approved" | "paid"] += r.amount;
    byAgent.set(r.user_id, a);
  }

  return (
    <>
      <PageHeader icon="percent" tone="amber" title="Commissions"
        sub={admin ? "Commission earned by each agent on won deals. Approve, then mark paid." : "Commission you earned on your won deals."}
        actions={
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm">
            <Link href={href({ month: shift(month, -1) })} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Previous month">‹</Link>
            <span className="min-w-32 text-center font-semibold text-navy-900">{label(month)}</span>
            {month < now ? <Link href={href({ month: shift(month, 1) })} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Next month">›</Link>
              : <span className="px-2 py-1 text-slate-300">›</span>}
          </div>
        } />
      {tabs}
      {!settings?.enabled && (
        <Notice>Commissions are off{admin ? <>. Turn them on and set the % in <Link className="font-medium underline" href="/commissions?tab=settings">Rates &amp; settings</Link>.</> : ". Ask your admin to set them up."}</Notice>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Earned this month" value={inr(sum())} sub={`${all.filter((r) => r.status !== "cancelled").length} deals`} icon="rupee" tone="green" />
        <Kpi label="Pending approval" value={inr(sum("pending"))} icon="clock" tone="amber" />
        <Kpi label="Approved, to pay" value={inr(sum("approved"))} icon="check" tone="blue" />
        <Kpi label="Paid" value={inr(sum("paid"))} icon="wallet" tone="violet" />
      </div>
      {byAgent.size > 1 || (admin && byAgent.size) ? (
        <Panel className="mb-4" title="By agent" icon="user">
          <Table head={["Agent", "Deals", "Deal value", "Pending", "Approved", "Paid", "Total"]}>
            {[...byAgent.entries()].sort((a, b) => (b[1].pending + b[1].approved + b[1].paid) - (a[1].pending + a[1].approved + a[1].paid)).map(([id, a]) => (
              <tr key={id}>
                <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={href({ agent: id })}>{a.name}</Link></td>
                <td className="td">{a.deals}</td><td className="td">{inr(a.value)}</td>
                <td className="td">{inr(a.pending)}</td><td className="td">{inr(a.approved)}</td><td className="td">{inr(a.paid)}</td>
                <td className="td font-semibold">{inr(a.pending + a.approved + a.paid)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
      <section className="card overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3" action="/commissions">
          <input type="hidden" name="month" value={month} />
          {byAgent.size > 1 || agent ? (
            <select name="agent" defaultValue={agent} className="input w-auto" aria-label="Agent"><option value="">All agents</option>
              {(people ?? []).filter((p) => all.some((r) => r.user_id === p.id) || p.id === agent).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
          ) : null}
          <select name="status" defaultValue={status} className="input w-auto" aria-label="Status"><option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
          <button className="btn-primary btn-sm">Filter</button>
          <span className="ml-auto text-sm text-slate-500">{rows.length} commission{rows.length === 1 ? "" : "s"}</span>
        </form>
        <CommissionList rows={rows} admin={admin} />
      </section>
    </>
  );
}
