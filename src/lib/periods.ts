import { istDate, istMidnight } from "./dates";

// Period picker shared by Win / Loss and the report builder (IST, inclusive dates).
const DAY = 86400000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const addDays = (ymd: string, n: number) => new Date(new Date(ymd + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);

export const PERIODS = [
  { value: "month", label: "This month" }, { value: "last_month", label: "Last month" },
  { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 6 months" }, { value: "year", label: "This year (Apr–Mar)" }, { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
] as const;

function base(preset: string, f?: string, t?: string): { from: string; to: string } {
  const today = istDate();
  switch (preset) {
    case "last_month": { const first = today.slice(0, 8) + "01"; const end = addDays(first, -1); return { from: end.slice(0, 8) + "01", to: end }; }
    case "7": case "30": case "90": case "180": return { from: addDays(today, -(Number(preset) - 1)), to: today };
    case "year": { const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0); return { from: `${y}-04-01`, to: today }; }
    case "all": return { from: "2020-01-01", to: today };
    case "custom": {
      const from = f && YMD.test(f) ? f : today;
      let to = t && YMD.test(t) ? t : from;
      if (to < from) to = from;
      return { from, to };
    }
    default: return { from: today.slice(0, 8) + "01", to: today };
  }
}

/** Preset + inclusive from/to (YYYY-MM-DD) + timestamps [start, end) for queries. Edited dates win over the preset. */
export function resolvePeriod(sp: { preset?: string; from?: string; to?: string }, fallback = "month") {
  let preset: string = PERIODS.some((p) => p.value === sp.preset) ? sp.preset! : fallback;
  const b = base(preset, sp.from, sp.to);
  if (preset !== "custom" && ((sp.from && sp.from !== b.from) || (sp.to && sp.to !== b.to))) preset = "custom";
  const { from, to } = preset === "custom" ? base("custom", sp.from ?? b.from, sp.to ?? b.to) : b;
  return { preset, from, to, start: istMidnight(from).toISOString(), end: new Date(istMidnight(to).getTime() + DAY).toISOString() };
}
