import { istDate, istMidnight } from "./dates";

const DAY = 86400000;

/** Date ranges offered on the analytics page (all IST). */
export const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "90d", label: "Last 90 Days" },
  { value: "custom", label: "Custom Range" },
] as const;
export type RangeKey = (typeof RANGES)[number]["value"];

const ymdOk = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const addDays = (ymd: string, n: number) => new Date(new Date(ymd + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);

/** Inclusive IST day list + half-open UTC instants for a range key. */
export function analyticsRange(key: string | undefined, fromYmd?: string, toYmd?: string) {
  const today = istDate();
  let f = addDays(today, -6), t = today;
  const k = (RANGES.some((r) => r.value === key) ? key : "7d") as RangeKey;
  if (k === "today") f = today;
  else if (k === "yesterday") f = t = addDays(today, -1);
  else if (k === "30d") f = addDays(today, -29);
  else if (k === "90d") f = addDays(today, -89);
  else if (k === "month") f = today.slice(0, 8) + "01";
  else if (k === "last_month") { t = addDays(today.slice(0, 8) + "01", -1); f = t.slice(0, 8) + "01"; }
  else if (k === "custom") {
    f = ymdOk(fromYmd) ? fromYmd! : today;
    t = ymdOk(toYmd) ? toYmd! : f;
    if (t < f) [f, t] = [t, f];
    if (addDays(f, 366) < t) f = addDays(t, -366); // keep the chart readable and the queries bounded
  }
  const days: string[] = [];
  for (let d = f; d <= t; d = addDays(d, 1)) days.push(d);
  return { key: k, fromYmd: f, toYmd: t, days, from: istMidnight(f), to: new Date(istMidnight(t).getTime() + DAY) };
}

export const shiftDay = addDays;

/** Fixed categorical order (validated palette). Index = the entity's stable position, never its rank. */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const OTHER_COLOR = "#94a3b8";

/** Short IST day label, e.g. "Oct 30". */
export const dayLabel = (ymd: string) => new Date(ymd + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });

/** Read every row of a PostgREST query in pages of 1000 (the API's row cap), up to `max`. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 20000) {
  const out: T[] = [];
  for (let off = 0; off < max; off += 1000) {
    const { data, error } = await page(off, off + 999);
    if (error) return { rows: out, error: error.message };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows: out, error: null as string | null };
}
