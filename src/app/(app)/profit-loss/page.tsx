import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel, Bars, Legend, Icon } from "@/components/kit";
import { istDate, fmtDay, fmtDateTime, money } from "@/lib/dates";
import { metaSyncState, syncMetaSpendIfStale } from "@/lib/meta-spend";
import { EntryForm, EntryRow, SyncButton } from "./ui";

export const metadata = { title: "Profit & Loss" };
export const dynamic = "force-dynamic";

const DAY = 86400000;
const addDays = (ymd: string, n: number) => new Date(new Date(ymd + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const PRESETS = [
  { value: "month", label: "This month" }, { value: "last_month", label: "Last month" },
  { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" },
  { value: "year", label: "This year (Apr–Mar)" }, { value: "custom", label: "Custom range" },
] as const;

/** Inclusive IST dates for a preset. */
function range(preset: string, f?: string, t?: string): { from: string; to: string } {
  const today = istDate();
  switch (preset) {
    case "last_month": { const first = today.slice(0, 8) + "01"; const end = addDays(first, -1); return { from: end.slice(0, 8) + "01", to: end }; }
    case "7": case "30": case "90": return { from: addDays(today, -(Number(preset) - 1)), to: today };
    case "year": { const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0); return { from: `${y}-04-01`, to: today }; }
    case "custom": {
      const from = f && YMD.test(f) ? f : today;
      let to = t && YMD.test(t) ? t : from;
      if (to < from) to = from;
      if (new Date(to).getTime() - new Date(from).getTime() > 400 * DAY) to = addDays(from, 400);
      return { from, to };
    }
    default: return { from: today.slice(0, 8) + "01", to: today };
  }
}

type PL = { ad_meta: number; ad_manual: number; sales_won: number; won_count: number; sales_paid?: number; paid_count?: number; sales_manual: number;
  expenses?: number; expense_count?: number; expenses_pending?: number; pending_count?: number;
  expense_cats?: { category: string; amount: number; count: number }[]; expense_users?: { user_id: string; name: string; amount: number; count: number }[];
  days: { day: string; ad: number; sales: number; exp?: number }[]; sources: { source_id: string | null; name: string; ad: number; sales: number; won: number; paid?: number }[] };
type Entry = { id: string; kind: "ad_cost" | "sale"; entry_date: string; amount: number; channel: string; source_id: string | null; note: string; origin: string; ext_name: string | null; currency: string | null };

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await requireAdmin();
  let preset: string = PRESETS.some((p) => p.value === sp.preset) ? sp.preset! : "month";
  // Edited From / To dates win over the preset (no need to pick "Custom range" first).
  const base = range(preset, sp.from, sp.to);
  if (preset !== "custom" && ((sp.from && sp.from !== base.from) || (sp.to && sp.to !== base.to))) preset = "custom";
  const { from, to } = preset === "custom" ? range("custom", sp.from ?? base.from, sp.to ?? base.to) : base;
  const sb = await createClient();

  // Meta ad spend: pulled automatically when the last pull is old or didn't cover this range.
  const meta = await metaSyncState(profile.company_id).catch(() => ({ connected: false, state: null }));
  let syncError: string | null = null;
  if (meta.connected) {
    const r = await syncMetaSpendIfStale(profile.company_id, from, to, meta.state);
    if (r) { syncError = r.error ?? null; meta.state = (await metaSyncState(profile.company_id)).state; }
    else syncError = meta.state?.error ?? null;
  }

  const [plR, entR, srcR, buyR] = await Promise.all([
    sb.rpc("lb_profit_loss", { p_from: from, p_to: to }),
    sb.from("lb_pl_entries").select("id,kind,entry_date,amount,channel,source_id,note,origin,ext_name,currency")
      .eq("company_id", profile.company_id).gte("entry_date", from).lte("entry_date", to)
      .order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    sb.from("lb_sources").select("id,name").eq("company_id", profile.company_id).eq("is_active", true).order("name"),
    // Stock bought from vendors (purchase-orders SQL): value of goods received in the period. Missing SQL = no purchases line.
    sb.rpc("lb_purchase_cost", { p_from: from, p_to: to }),
  ]);
  const buy = buyR.error ? null : (buyR.data as { total: number; receipts: number; vendors: { vendor_id: string; name: string; amount: number }[] } | null);
  const sources = (srcR.data ?? []) as { id: string; name: string }[];
  const srcName = new Map(sources.map((s) => [s.id, s.name]));
  const entries = (entR.data ?? []) as Entry[];
  const pl = plR.data as PL | null;
  const n = (v: unknown) => Number(v ?? 0);

  const adCost = n(pl?.ad_meta) + n(pl?.ad_manual);
  const sales = n(pl?.sales_paid) + n(pl?.sales_won) + n(pl?.sales_manual);
  const salesSub = [n(pl?.sales_paid) && `Payments ${money(pl?.sales_paid)}`, `Won leads ${money(pl?.sales_won ?? 0)}`, n(pl?.sales_manual) && `Manual ${money(pl?.sales_manual)}`].filter(Boolean).join(" · ");
  // Approved / paid expense claims from the Field app count as a cost (by expense date).
  const expenses = n(pl?.expenses);
  const grossProfit = sales - adCost;
  // Goods received on purchase orders (Store → Purchase orders) count as a cost on the date received.
  const purchases = n(buy?.total);
  const profit = grossProfit - expenses - purchases;
  const roas = adCost > 0 ? sales / adCost : null;
  const foreign = [...new Set(entries.filter((e) => e.origin === "meta" && e.currency && e.currency !== "INR").map((e) => e.currency))];
  const period = `${fmtDay(from + "T12:00:00Z")} – ${fmtDay(to + "T12:00:00Z")}`;

  // Day-wise chart: group by week/month when the range is long.
  const dayRows = pl?.days ?? [];
  const span = (new Date(to).getTime() - new Date(from).getTime()) / DAY + 1;
  const bucket = (d: string) => (span > 120 ? d.slice(0, 7) : span > 45 ? addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7)) : d);
  const grouped = new Map<string, { ad: number; sales: number; exp: number }>();
  for (const r of dayRows) { const k = bucket(r.day); const g = grouped.get(k) ?? { ad: 0, sales: 0, exp: 0 }; g.ad += n(r.ad); g.sales += n(r.sales); g.exp += n(r.exp); grouped.set(k, g); }
  const label = (k: string) => (k.length === 7 ? new Date(k + "-01T12:00:00Z").toLocaleString("en-IN", { month: "short" }) : k.slice(8, 10) + "/" + k.slice(5, 7));
  const chart = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => ({ label: label(k), values: [Math.round(g.sales), Math.round(g.ad), Math.round(g.exp)] }));
  const SERIES3 = [{ name: "Sales", color: "#22c55e" }, { name: "Ad cost", color: "#f59e0b" }, { name: "Expenses", color: "#ef4444" }];
  const CAT: Record<string, string> = { travel: "Travel", fuel: "Fuel", food: "Food", stay: "Stay / hotel", client: "Client meeting", phone: "Phone / internet", other: "Other" };

  return (
    <>
      <PageHeader title="Profit & Loss" icon="rupee" sub={<>Sales minus ad cost, team expenses and stock purchases · {period} (IST)</>} />

      <form action="/profit-loss" className="card mb-4 grid grid-cols-2 gap-1.5 p-2 sm:flex sm:flex-wrap sm:items-center">
        <select className="input h-8 py-1! text-xs! sm:w-auto" name="preset" defaultValue={preset} aria-label="Period">
          {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <input className="input h-8 py-1! text-xs! sm:w-36" type="date" name="from" defaultValue={from} aria-label="From" title="From (pick Custom range)" />
        <input className="input h-8 py-1! text-xs! sm:w-36" type="date" name="to" defaultValue={to} aria-label="To" title="To, inclusive (pick Custom range)" />
        <div className="col-span-2 flex gap-1.5 sm:ml-auto">
          <button className="btn-primary btn-sm h-8 flex-1 px-3"><Icon name="filter" className="h-3.5 w-3.5" />Apply</button>
          <Link className="btn-ghost btn-sm h-8 px-3" href="/profit-loss">Reset</Link>
        </div>
      </form>
      <p className="-mt-2 mb-4 text-xs text-slate-500">Changing the From / To dates switches to a custom range automatically.</p>

      {plR.error && <div className="mb-4"><ErrorBox message={plR.error.message.includes("lb_profit_loss") ? "Profit & Loss is not set up in the database yet (run the profit-loss SQL)." : plR.error.message} /></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sales value" value={money(sales)} sub={salesSub} title="Payments received (Razorpay links on quotations/invoices) + won value of leads won without a payment + manual sales" icon="trophy" tone="green" />
        <Kpi label="Total cost" value={money(adCost + expenses + purchases)} sub={`Ads ${money(adCost)} · Team expenses ${money(expenses)}${purchases > 0 ? ` · Stock purchases ${money(purchases)}` : ""}`}
          title={`Ad cost: Meta ${money(pl?.ad_meta ?? 0)} + manual ${money(pl?.ad_manual ?? 0)}. Team expenses: approved expense claims from the Field app. Stock purchases: goods received on purchase orders.`} icon="megaphone" tone="amber" />
        <Kpi label={profit >= 0 ? "Profit" : "Loss"} value={<span className={profit >= 0 ? "text-brand-700" : "text-red-600"}>{money(Math.abs(profit))}</span>}
          sub={sales > 0 ? `Margin ${Math.round((profit / sales) * 100)}% of sales` : purchases > 0 ? "Sales − ad cost − expenses − purchases" : "Sales − ad cost − expenses"} icon="rupee" tone={profit >= 0 ? "green" : "red"} />
        <Kpi label="Return on ad spend" value={roas == null ? "—" : `${roas.toFixed(2)}x`} sub={roas == null ? "No ad cost in this period" : `₹${roas.toFixed(2)} sales for every ₹1 spent`} icon="percent" tone="blue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Sales vs costs" icon="chart" className="lg:col-span-2"
          actions={<Legend items={SERIES3} />}
          sub={span > 120 ? "Month-wise" : span > 45 ? "Week-wise (week starting)" : "Day-wise"}>
          {chart.length ? <Bars rows={chart} series={SERIES3} height={180} />
            : <p className="py-10 text-center text-sm text-slate-500">No sales or costs in this period.</p>}
        </Panel>

        <Panel title="Meta ad spend" icon="facebook" tone="blue">
          {meta.connected ? (
            <div className="space-y-3 text-sm">
              <p className="text-slate-600">Ad spend of every ad account in your connected Facebook login is pulled automatically (refreshed every 3 hours when you open this page).</p>
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-slate-500">Last pulled</dt><dd className="font-medium text-navy-900">{fmtDateTime(meta.state?.synced_at)}</dd>
                <dt className="text-slate-500">Ad accounts</dt><dd className="font-medium text-navy-900">{meta.state?.accounts ?? 0}</dd>
                <dt className="text-slate-500">This period</dt><dd className="font-medium text-navy-900">{money(pl?.ad_meta ?? 0)}</dd>
              </dl>
              {syncError && <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">{syncError}</p>}
              {foreign.length > 0 && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Some ad accounts bill in {foreign.join(", ")}. Their spend is shown as-is (not converted to ₹).</p>}
              <SyncButton from={from} to={to} />
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-600">
              <p>Connect Facebook to pull your Meta ad spend automatically. Until then, add ad cost manually below.</p>
              <Link href="/admin/fb-login" className="btn rounded-full bg-[#1877F2] px-4 text-white hover:bg-[#166FE5]">Connect Facebook</Link>
            </div>
          )}
        </Panel>
      </div>

      {buy && purchases > 0 && (
        <Panel title="Stock purchases" icon="cart" tone="violet" className="mt-4"
          sub={<>Goods received from vendors on purchase orders in this period ({buy.receipts} receipt{buy.receipts === 1 ? "" : "s"}). Counted in Profit above.</>}
          actions={<Link href="/store/purchases" className="btn-ghost btn-sm">Purchase orders</Link>}>
          <ul className="divide-y text-sm">
            {buy.vendors.map((v) => (
              <li key={v.vendor_id} className="flex justify-between py-1.5"><Link href={`/store/purchases?vendor=${v.vendor_id}`} className="text-navy-900 hover:text-brand-700">{v.name}</Link><span className="font-medium">{money(v.amount)}</span></li>
            ))}
            <li className="flex justify-between py-1.5 font-semibold"><span>Total</span><span>{money(purchases)}</span></li>
          </ul>
        </Panel>
      )}

      <Panel title="Source-wise profit" icon="layers" className="mt-4" sub="Sales = payments received on quotations/invoices + won value of leads won without a payment + manual sales. Meta spend counts under the Facebook source.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Source</th><th className="th text-right">Won leads</th><th className="th text-right">Payments</th><th className="th text-right">Sales</th><th className="th text-right">Ad cost</th><th className="th text-right">Profit / Loss</th><th className="th text-right">ROAS</th></tr></thead>
            <tbody className="divide-y">
              {(pl?.sources ?? []).map((s) => { const p = n(s.sales) - n(s.ad); return (
                <tr key={s.source_id ?? "none"}>
                  <td className="td font-medium text-navy-900">{s.name}</td><td className="td text-right">{s.won}</td><td className="td text-right">{n(s.paid)}</td>
                  <td className="td text-right">{money(s.sales)}</td><td className="td text-right">{money(s.ad)}</td>
                  <td className={`td text-right font-semibold ${p >= 0 ? "text-brand-700" : "text-red-600"}`}>{p < 0 ? "−" : ""}{money(Math.abs(p))}</td>
                  <td className="td text-right">{n(s.ad) > 0 ? `${(n(s.sales) / n(s.ad)).toFixed(2)}x` : "—"}</td>
                </tr>); })}
              {!pl?.sources?.length && <tr><td className="td text-slate-500" colSpan={7}>Nothing in this period.</td></tr>}
            </tbody>
            {!!pl?.sources?.length && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold"><tr>
                <td className="td">Total</td><td className="td text-right">{n(pl?.won_count)}</td><td className="td text-right">{n(pl?.paid_count)}</td><td className="td text-right">{money(sales)}</td><td className="td text-right">{money(adCost)}</td>
                <td className={`td text-right ${grossProfit >= 0 ? "text-brand-700" : "text-red-600"}`}>{grossProfit < 0 ? "−" : ""}{money(Math.abs(grossProfit))}</td><td className="td text-right">{roas == null ? "—" : `${roas.toFixed(2)}x`}</td>
              </tr>
              {(expenses > 0 || purchases > 0) && <>
                {expenses > 0 && <tr className="font-normal"><td className="td" colSpan={5}>Team expenses (approved claims, not linked to a source)</td><td className="td text-right text-red-600">−{money(expenses)}</td><td className="td" /></tr>}
                {purchases > 0 && <tr className="font-normal"><td className="td" colSpan={5}>Stock purchases (goods received from vendors)</td><td className="td text-right text-red-600">−{money(purchases)}</td><td className="td" /></tr>}
                <tr><td className="td" colSpan={5}>Net profit / loss</td><td className={`td text-right ${profit >= 0 ? "text-brand-700" : "text-red-600"}`}>{profit < 0 ? "−" : ""}{money(Math.abs(profit))}</td><td className="td" /></tr>
              </>}
              </tfoot>
            )}
          </table>
        </div>
      </Panel>

      <Panel title="Team expenses" icon="wallet" tone="red" className="mt-4"
        sub="Approved and paid expense claims from the Field app (travel, fuel, food…), by expense date. Pending claims count once a manager approves them."
        actions={<Link href="/field/expenses" className="btn-ghost btn-sm">Expense claims</Link>}>
        {n(pl?.expenses_pending) > 0 && (
          <p className="mb-3 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            {n(pl?.pending_count)} claim{n(pl?.pending_count) === 1 ? "" : "s"} worth {money(pl?.expenses_pending)} waiting for approval in this period (not counted yet). <Link href="/field/expenses" className="font-semibold underline">Review</Link>
          </p>
        )}
        {expenses > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="th">Category</th><th className="th text-right">Claims</th><th className="th text-right">Amount</th></tr></thead>
                <tbody className="divide-y">
                  {(pl?.expense_cats ?? []).map((c) => <tr key={c.category}><td className="td">{CAT[c.category] ?? c.category}</td><td className="td text-right">{c.count}</td><td className="td text-right">{money(c.amount)}</td></tr>)}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold"><tr><td className="td">Total</td><td className="td text-right">{n(pl?.expense_count)}</td><td className="td text-right">{money(expenses)}</td></tr></tfoot>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="th">Agent</th><th className="th text-right">Claims</th><th className="th text-right">Amount</th></tr></thead>
                <tbody className="divide-y">
                  {(pl?.expense_users ?? []).map((u) => <tr key={u.user_id}><td className="td">{u.name}</td><td className="td text-right">{u.count}</td><td className="td text-right">{money(u.amount)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        ) : <p className="py-4 text-center text-sm text-slate-500">No approved expense claims in this period.</p>}
      </Panel>

      <Panel title="Ad cost & sale entries" icon="list" className="mt-4" sub="Add ad cost (Google, offline, or Meta if not connected) and sales that are not in the CRM as won leads or payments. Meta rows are pulled automatically and can't be edited.">
        <EntryForm sources={sources} defaultDate={to} />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Type</th><th className="th">Channel / account</th><th className="th">Source</th><th className="th">Note</th><th className="th text-right">Amount</th><th className="th" /></tr></thead>
            <tbody className="divide-y">
              {entries.map((e) => <EntryRow key={e.id} e={{ ...e, source: e.source_id ? srcName.get(e.source_id) ?? "—" : "—", day: fmtDay(e.entry_date + "T12:00:00Z") }} sources={sources} />)}
              {!entries.length && <tr><td className="td text-slate-500" colSpan={7}>No entries in this period.</td></tr>}
            </tbody>
          </table>
          {entries.length >= 500 && <p className="p-2 text-xs text-slate-500">Showing the latest 500 entries. Totals above include all of them.</p>}
        </div>
      </Panel>
    </>
  );
}
