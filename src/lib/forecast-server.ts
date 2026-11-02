import "server-only";
import { buildSeries, monthStart, type HistoryRow, type PipelineRow } from "./forecast";

type Sb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

export type ForecastTarget = "this" | "next";
export const parseTarget = (v?: string): ForecastTarget => (v === "this" ? "this" : "next");

/** 12 complete months + this month so far + open pipeline, seen through the caller's RLS. */
export async function loadForecastData(sb: Sb, target: ForecastTarget) {
  const current = monthStart(0);
  const months = Array.from({ length: 12 }, (_, i) => monthStart(i - 12));
  const [h, p] = await Promise.all([sb.rpc("lb_forecast_history", { p_months: 13 }), sb.rpc("lb_forecast_pipeline")]);
  const error = h.error?.message ?? p.error?.message;
  const series = buildSeries((h.data as HistoryRow[]) ?? [], (p.data as PipelineRow[]) ?? [], months, current);
  return { error, series, months, current, target: target === "this" ? current : monthStart(1) };
}
