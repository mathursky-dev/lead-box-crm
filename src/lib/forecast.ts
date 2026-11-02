// Product-wise sales forecast: shared types and the plain (non-AI) trend forecast.
// No server-only imports: used by the page, the server action and the AI prompt.

export type HistoryRow = { month: string; product_id: string | null; product: string; qty: number; revenue: number; deals: number };
export type PipelineRow = {
  product_id: string | null; product: string; open_leads: number; hot: number; warm: number; open_value: number;
  won_6m: number; lost_6m: number; avg_days_to_win: number | null;
};

export type ProductSeries = {
  key: string; product: string;
  months: { month: string; qty: number; revenue: number; deals: number }[]; // complete months, oldest first
  mtd: { qty: number; revenue: number; deals: number };                     // current month so far
  pipeline: PipelineRow | null;
  winRate: number | null;            // won / (won + lost), last 6 months
  pipelineValue: number;             // open value x win rate (Hot leads weigh more)
  trend: { qty: number; revenue: number; direction: "up" | "flat" | "down" };
};

export type AiProduct = {
  product: string; qty: number; revenue: number; low: number; high: number;
  direction: "up" | "flat" | "down"; confidence: "high" | "medium" | "low"; reason: string;
};
export type AiForecast = { summary: string; total_revenue: number; total_low: number; total_high: number; products: AiProduct[]; tips: string[] };

const IST_MS = 5.5 * 3600 * 1000;
/** First day (YYYY-MM-01) of the IST month `offset` months from now. */
export function monthStart(offset = 0, now = new Date()) {
  const d = new Date(now.getTime() + IST_MS);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return m.toISOString().slice(0, 10);
}
export const monthLabel = (ymd: string, long = false) =>
  new Date(ymd + "T00:00:00Z").toLocaleDateString("en-IN", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });

/** Days in the IST month containing `ymd`, and how many have passed (for "this month" forecasts). */
export function monthProgress(ymd: string, now = new Date()) {
  const d = new Date(ymd + "T00:00:00Z");
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const today = new Date(now.getTime() + IST_MS);
  const same = today.getUTCFullYear() === d.getUTCFullYear() && today.getUTCMonth() === d.getUTCMonth();
  return { days, passed: same ? today.getUTCDate() : 0 };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Weighted recent average x damped trend. Simple, explainable and never negative. */
function trendOf(values: number[]) {
  const last = values.slice(-3);
  if (!last.length || last.every((v) => v === 0)) return { value: 0, ratio: 1 };
  const w = [0.2, 0.3, 0.5].slice(-last.length);
  const wsum = w.reduce((a, b) => a + b, 0);
  const avg = last.reduce((a, v, i) => a + v * w[i], 0) / wsum;
  const prev = values.slice(-6, -3);
  const pAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
  const lAvg = last.reduce((a, b) => a + b, 0) / last.length;
  const ratio = pAvg > 0 ? Math.min(1.3, Math.max(0.7, Math.sqrt(lAvg / pAvg))) : 1;
  return { value: Math.max(0, avg * ratio), ratio };
}

/**
 * Builds one series per product from the history + pipeline RPCs.
 * `months` = the complete months to show (oldest first); `current` = this month (partial).
 */
export function buildSeries(history: HistoryRow[], pipeline: PipelineRow[], months: string[], current: string): ProductSeries[] {
  const key = (id: string | null, name: string) => id ?? `name:${name.toLowerCase()}`;
  const map = new Map<string, ProductSeries>();
  const get = (id: string | null, name: string) => {
    const k = key(id, name);
    let s = map.get(k);
    if (!s) {
      s = { key: k, product: name, months: months.map((m) => ({ month: m, qty: 0, revenue: 0, deals: 0 })), mtd: { qty: 0, revenue: 0, deals: 0 },
        pipeline: null, winRate: null, pipelineValue: 0, trend: { qty: 0, revenue: 0, direction: "flat" } };
      map.set(k, s);
    }
    return s;
  };
  for (const h of history) {
    const s = get(h.product_id, h.product);
    const month = String(h.month).slice(0, 10);
    const slot = month === current ? s.mtd : s.months.find((m) => m.month === month);
    if (!slot) continue;
    slot.qty += Number(h.qty) || 0; slot.revenue += Number(h.revenue) || 0; slot.deals += Number(h.deals) || 0;
  }
  for (const p of pipeline) {
    if (!p.open_leads && !p.won_6m && !map.has(key(p.product_id, p.product))) continue;
    const s = get(p.product_id, p.product);
    s.pipeline = p;
    const closed = Number(p.won_6m) + Number(p.lost_6m);
    s.winRate = closed >= 3 ? Number(p.won_6m) / closed : null;
    // Hot leads count fully, warm half, the rest a quarter; times the win rate (or 20% if unknown).
    const open = Number(p.open_leads) || 0;
    const avgValue = open ? Number(p.open_value) / open : 0;
    const weighted = Number(p.hot) + Number(p.warm) * 0.5 + Math.max(0, open - p.hot - p.warm) * 0.25;
    s.pipelineValue = r2(avgValue * weighted * (s.winRate ?? 0.2));
  }
  for (const s of map.values()) {
    const rev = trendOf(s.months.map((m) => m.revenue));
    const qty = trendOf(s.months.map((m) => m.qty));
    s.trend = { revenue: r2(rev.value), qty: Math.round(qty.value * 10) / 10, direction: rev.ratio > 1.05 ? "up" : rev.ratio < 0.95 ? "down" : "flat" };
  }
  return [...map.values()].sort((a, b) =>
    (b.trend.revenue + b.pipelineValue + b.mtd.revenue) - (a.trend.revenue + a.pipelineValue + a.mtd.revenue) || a.product.localeCompare(b.product));
}

/** Compact data the AI sees (numbers only, product names quoted as data). */
export function aiInput(series: ProductSeries[], months: string[], target: string, current: string) {
  const prog = monthProgress(current);
  return {
    target_month: target,
    current_month: { month: current, days_passed: prog.passed, days_in_month: prog.days },
    months,
    products: series.slice(0, 40).map((s) => ({
      product: s.product,
      monthly_revenue: s.months.map((m) => Math.round(m.revenue)),
      monthly_qty: s.months.map((m) => r2(m.qty)),
      month_to_date: { revenue: Math.round(s.mtd.revenue), qty: r2(s.mtd.qty) },
      trend_forecast: { revenue: Math.round(s.trend.revenue), qty: s.trend.qty },
      pipeline: s.pipeline ? {
        open_leads: s.pipeline.open_leads, hot: s.pipeline.hot, warm: s.pipeline.warm, open_value: Math.round(Number(s.pipeline.open_value)),
        win_rate_6m: s.winRate == null ? null : Math.round(s.winRate * 100) / 100, avg_days_to_win: s.pipeline.avg_days_to_win,
      } : null,
    })),
  };
}
