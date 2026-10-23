// All reporting uses Asia/Kolkata (UTC+05:30, no DST). Storage is UTC timestamptz.
const IST_MS = 330 * 60 * 1000;
const DAY = 86400000;

export const TZ = "Asia/Kolkata";

/** yyyy-mm-dd of an instant, in IST. */
export function istDate(d: Date = new Date()) {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** UTC instant for IST midnight of yyyy-mm-dd. */
export function istMidnight(ymd: string) {
  return new Date(new Date(ymd + "T00:00:00Z").getTime() - IST_MS);
}

export type Preset = "today" | "yesterday" | "week" | "month" | "custom";
export const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom Range" },
];

/** Half-open [from, to) range for a preset; custom uses inclusive IST dates. */
export function rangeFor(preset: Preset, fromYmd?: string, toYmd?: string) {
  const today = istDate();
  const t0 = istMidnight(today);
  switch (preset) {
    case "yesterday":
      return { from: new Date(t0.getTime() - DAY), to: t0 };
    case "week": {
      const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
      return { from: new Date(t0.getTime() - dow * DAY), to: new Date(t0.getTime() + DAY) };
    }
    case "month":
      return { from: istMidnight(today.slice(0, 8) + "01"), to: new Date(t0.getTime() + DAY) };
    case "custom": {
      const f = fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd) ? fromYmd : today;
      const t = toYmd && /^\d{4}-\d{2}-\d{2}$/.test(toYmd) ? toYmd : f;
      return { from: istMidnight(f), to: new Date(istMidnight(t).getTime() + DAY) };
    }
    default:
      return { from: t0, to: new Date(t0.getTime() + DAY) };
  }
}

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
const fmtTime = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const fmtDateTime = (v?: string | null) => (v ? fmt.format(new Date(v)) : "—");
export const fmtDay = (v?: string | null) => (v ? fmtDate.format(new Date(v)) : "—");
export const fmtClock = (v?: string | null) => (v ? fmtTime.format(new Date(v)) : "");

/** Value for <input type="datetime-local"> in IST, and back to ISO. */
export const toLocalInput = (v?: string | null) => (v ? new Date(new Date(v).getTime() + IST_MS).toISOString().slice(0, 16) : "");
export const fromLocalInput = (v: string) => (v ? new Date(new Date(v + ":00Z").getTime() - IST_MS).toISOString() : null);

export const money = (v?: number | string | null) =>
  v == null || v === "" ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v));

/** ISO timestamp for N days before now. */
export const daysAgoIso = (days: number) => new Date(Date.now() - days * DAY).toISOString();
