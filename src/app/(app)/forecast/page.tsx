import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel, Bars, Legend, PillTabs, EmptyState, Notice } from "@/components/kit";
import { money, fmtDateTime } from "@/lib/dates";
import { monthLabel, monthProgress, monthStart, type AiForecast } from "@/lib/forecast";
import { loadForecastData, parseTarget } from "@/lib/forecast-server";
import { RunForecastButton } from "./run-button";

export const metadata = { title: "AI Sales Forecast" };
export const dynamic = "force-dynamic";

const ARROW = { up: "▲", flat: "▬", down: "▼" } as const;
const ARROW_CLS = { up: "text-brand-700", flat: "text-slate-500", down: "text-red-600" } as const;
const CONF_CLS = { high: "bg-emerald-50 text-emerald-700", medium: "bg-amber-50 text-amber-800", low: "bg-slate-100 text-slate-600" } as const;
const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function ForecastPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { profile, company, features } = await requireProfile();
  if (!can(profile, "reports.view")) redirect("/dashboard");
  const which = parseTarget((await searchParams).m);
  const sb = await createClient();
  const d = await loadForecastData(sb, which);
  const [{ data: co }, { data: saved }, { data: users }] = await Promise.all([
    sb.from("lb_companies").select("ai_enabled").eq("id", company.id).single(),
    sb.from("lb_sales_forecasts").select("id,month,created_at,created_by,result").eq("month", d.target).order("created_at", { ascending: false }).limit(1),
    sb.from("lb_profiles").select("id,full_name"),
  ]);
  const aiReady = features.includes("ai") && Boolean(co?.ai_enabled) && aiConfigured() && can(profile, "ai.use");
  const last = saved?.[0] as { created_at: string; created_by: string | null; result: AiForecast } | undefined;
  const ai = last?.result;
  const aiBy = new Map((ai?.products ?? []).map((p) => [p.product.toLowerCase(), p]));
  const who = (users ?? []).find((u: { id: string }) => u.id === last?.created_by)?.full_name;

  const isThis = which === "this";
  const prog = monthProgress(d.current);
  const mtd = d.series.reduce((a, s) => a + s.mtd.revenue, 0);
  // Plain forecast: next month = trend; this month = the bigger of trend and the month-to-date run rate.
  const plain = (s: (typeof d.series)[number]) =>
    isThis ? Math.max(s.trend.revenue, s.mtd.revenue, prog.passed ? (s.mtd.revenue / prog.passed) * prog.days * 0.8 + s.trend.revenue * 0.2 : 0) : s.trend.revenue;
  const plainTotal = d.series.reduce((a, s) => a + plain(s), 0);
  const lastMonth = d.series.reduce((a, s) => a + (s.months.at(-1)?.revenue ?? 0), 0);
  const forecast = ai?.total_revenue ?? plainTotal;
  const growth = lastMonth > 0 ? ((forecast - lastMonth) / lastMonth) * 100 : null;
  const hot = d.series.reduce((a, s) => a + (s.pipeline?.hot ?? 0), 0);
  const openValue = d.series.reduce((a, s) => a + Number(s.pipeline?.open_value ?? 0), 0);
  const target = monthLabel(d.target, true);

  const chart = [
    ...d.months.map((m, i) => ({ label: monthLabel(m), values: [Math.round(d.series.reduce((a, s) => a + s.months[i].revenue, 0)), 0] })),
    ...(isThis ? [] : [{ label: `${monthLabel(d.current)} *`, values: [Math.round(mtd), 0] }]),
    { label: `${monthLabel(d.target)} F`, values: [isThis ? Math.round(mtd) : 0, Math.round(Math.max(0, forecast - (isThis ? mtd : 0)))] },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader title="AI Sales Forecast" icon="sparkle" tone="navy"
        sub={<>Product-wise sales expected in <b>{target}</b>, from your won leads, paid invoices, store orders and open pipeline.</>}
        actions={aiReady ? <RunForecastButton target={which} label={ai ? "Run AI forecast again" : "Run AI forecast"} /> : undefined} />
      <PillTabs label="Forecast month" tabs={[
        { href: "/forecast", label: `Next month · ${monthLabel(monthStart(1))}`, active: !isThis, icon: "calendar" },
        { href: "/forecast?m=this", label: `This month · ${monthLabel(d.current)}`, active: isThis, icon: "clock" },
      ]} />
      {d.error && <ErrorBox message={d.error} />}
      {!aiReady && (
        <div className="mb-4"><Notice>
          AI forecast is off: {!features.includes("ai") ? "AI is not in your plan." : !co?.ai_enabled ? "turn AI on in Admin → Settings." : !can(profile, "ai.use") ? "you don't have the AI permission." : "the server has no AI key."} The trend forecast below still works.
        </Notice></div>
      )}

      {d.series.length === 0 ? (
        <EmptyState icon="chart" title="No sales to forecast from yet">
          The forecast learns from leads marked <b>Won</b> (with a product and value), paid invoices in <Link className="text-brand-700 underline" href="/quotes">Quotes &amp; Invoices</Link> and <Link className="text-brand-700 underline" href="/store">store orders</Link>. Add a product to your leads so sales show product-wise.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={`${ai ? "AI forecast" : "Trend forecast"} · ${monthLabel(d.target)}`} value={money(forecast)} icon="sparkle" tone="navy"
              sub={ai ? `Range ${money(ai.total_low)} – ${money(ai.total_high)}` : "Run AI for a smarter forecast"} />
            <Kpi label={`Last month · ${monthLabel(d.months.at(-1)!)}`} value={money(lastMonth)} icon="chart" tone="blue"
              sub={growth == null ? "No sales last month" : <span className={growth >= 0 ? "text-brand-700" : "text-red-600"}>{growth >= 0 ? "▲" : "▼"} {Math.abs(growth).toFixed(0)}% forecast vs last month</span>} />
            <Kpi label={`${monthLabel(d.current)} so far`} value={money(mtd)} icon="clock" tone="green" sub={`Day ${prog.passed} of ${prog.days}`} />
            <Kpi label="Open pipeline" value={money(openValue)} icon="target" tone="amber" sub={`${hot} hot lead${hot === 1 ? "" : "s"} (AI score)`} href="/leads?ai=hot" />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Panel title="Monthly sales and forecast" icon="chart" className="lg:col-span-2"
              actions={<Legend items={[{ name: "Actual", color: "#22c55e" }, { name: "Forecast", color: "#8b5cf6" }]} />}
              sub={isThis ? "Last bar: this month so far (green) + rest of the month forecast (violet)." : "* = this month so far. F = forecast month."}>
              <Bars rows={chart} series={[{ name: "Actual", color: "#22c55e" }, { name: "Forecast", color: "#8b5cf6" }]} height={190} />
            </Panel>
            <Panel title="AI summary" icon="sparkle" tone="navy" sub={last ? `Made ${fmtDateTime(last.created_at)}${who ? ` by ${who}` : ""}` : undefined}>
              {ai ? (
                <div className="space-y-3 text-sm">
                  <p className="text-slate-700">{ai.summary}</p>
                  {ai.tips.length > 0 && (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">To hit the forecast</div>
                      <ul className="list-disc space-y-1 pl-5 text-slate-700">{ai.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">{aiReady ? `Click “Run AI forecast”. AI reads 12 months of sales, this month so far and your Hot/Warm leads, then gives a product-wise forecast for ${target} with a range and reasons.` : "AI forecast is not available. The trend forecast in the table uses your last 3 months with a trend adjustment."}</p>
              )}
            </Panel>
          </div>

          <Panel title="Product-wise forecast" icon="list" sub="Revenue includes tax. Qty = units sold (a won lead without line items counts as 1 deal).">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Product</th>
                    {d.months.slice(-3).map((m) => <th key={m} className="py-2 pr-3 text-right">{monthLabel(m)}</th>)}
                    <th className="py-2 pr-3 text-right">{monthLabel(d.current)} so far</th>
                    <th className="py-2 pr-3">Pipeline</th>
                    <th className="py-2 pr-3 text-right">Trend forecast</th>
                    <th className="py-2 pr-3 text-right">AI forecast</th>
                    <th className="py-2">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {d.series.map((s) => {
                    const a = aiBy.get(s.product.toLowerCase());
                    return (
                      <tr key={s.key} className="border-b align-top last:border-0">
                        <td className="py-2 pr-3 font-medium text-navy-900">{s.product}
                          <div className={`text-[11px] font-normal ${ARROW_CLS[s.trend.direction]}`}>{ARROW[s.trend.direction]} {s.trend.direction === "up" ? "growing" : s.trend.direction === "down" ? "slowing" : "steady"}</div></td>
                        {s.months.slice(-3).map((m) => (
                          <td key={m.month} className="py-2 pr-3 text-right tabular-nums">{m.revenue ? money(m.revenue) : <span className="text-slate-300">—</span>}
                            {m.qty > 0 && <div className="text-[11px] text-slate-400">{qtyFmt(m.qty)} qty</div>}</td>
                        ))}
                        <td className="py-2 pr-3 text-right tabular-nums">{s.mtd.revenue ? money(s.mtd.revenue) : <span className="text-slate-300">—</span>}</td>
                        <td className="py-2 pr-3 text-xs text-slate-600">
                          {s.pipeline?.open_leads ? <>{s.pipeline.open_leads} open · <b className="text-red-600">{s.pipeline.hot} hot</b> · {s.pipeline.warm} warm<div className="text-slate-400">{money(Number(s.pipeline.open_value))}{s.winRate != null ? ` · win ${Math.round(s.winRate * 100)}%` : ""}</div></> : <span className="text-slate-300">No open leads</span>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{money(plain(s))}{s.trend.qty > 0 && <div className="text-[11px] text-slate-400">~{qtyFmt(s.trend.qty)} qty</div>}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {a ? <><b className="text-violet-700">{money(a.revenue)}</b><div className="text-[11px] text-slate-500">{qtyFmt(a.qty)} qty · {money(a.low)}–{money(a.high)}</div></> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2 text-xs text-slate-600">
                          {a ? <><span className={`badge mr-1 ${CONF_CLS[a.confidence]}`}>{a.confidence}</span>{a.reason}</> : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="mt-3 text-xs text-slate-500">
            How sales are counted: paid invoices (line items), store / WhatsApp orders that are not cancelled, and Won leads that have no invoice or order (won value, product from the lead), so nothing is counted twice.
            Months are in IST. You see only the leads and orders you are allowed to see. A forecast is a guide, not a promise.
          </p>
        </>
      )}
    </div>
  );
}

