// Shared helpers for the WhatsApp Business dashboard (safe for server and client).

export type WaPrefs = {
  pause_bots_when_assigned: boolean;
  optout_enabled: boolean;
  optout_keywords: string;
  optin_keywords: string;
  optout_reply: string | null;
  optin_reply: string | null;
  hours_enabled: boolean;
  hours_from: string;
  hours_to: string;
  hours_days: number[];
  timezone: string;
  away_message: string | null;
};

export const DEFAULT_PREFS: WaPrefs = {
  pause_bots_when_assigned: true,
  optout_enabled: true,
  optout_keywords: "stop, stop all, stop promo, stop promotion, stop messages, unsubscribe",
  optin_keywords: "start, subscribe, unstop, resume, opt in, optin",
  optout_reply: "You've been unsubscribed and won't receive any more promotional messages from us. Reply START if you ever want them back.",
  optin_reply: "You're subscribed again — welcome back. Reply STOP at any time to unsubscribe.",
  hours_enabled: false,
  hours_from: "09:00",
  hours_to: "18:00",
  hours_days: [1, 2, 3, 4, 5, 6],
  timezone: "Asia/Kolkata",
  away_message: null,
};

export type WaBot = {
  id: string; name: string; keywords: string[]; match_type: "exact" | "contains" | "starts"; reply: string;
  hours_rule: "always" | "inside" | "outside"; number_id: string | null; priority: number; is_active: boolean; reply_count: number;
};

export const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
export const splitKeywords = (s: string) => s.split(/[,\n]/).map(norm).filter(Boolean);

/** Opt-out style match: whole message is the keyword, or starts with it and is at most five words. */
export function keywordHit(text: string, keywords: string[]) {
  const t = norm(text);
  if (!t) return null;
  const words = t.split(" ").length;
  return keywords.find((k) => t === k || (words <= 5 && (t.startsWith(k + " ") || t === k))) ?? null;
}

export function botMatches(bot: Pick<WaBot, "keywords" | "match_type">, text: string) {
  const t = norm(text);
  if (!t) return null;
  for (const raw of bot.keywords) {
    const k = norm(raw);
    if (!k) continue;
    if (bot.match_type === "exact" && t === k) return raw;
    if (bot.match_type === "starts" && (t === k || t.startsWith(k + " "))) return raw;
    if (bot.match_type === "contains" && (` ${t} `).includes(` ${k} `)) return raw;
  }
  return null;
}

/** First active bot (by priority) that matches, honouring number and business-hours rules. */
export function pickBot(bots: WaBot[], text: string, opts: { numberId?: string | null; insideHours: boolean }) {
  for (const b of [...bots].sort((a, z) => a.priority - z.priority)) {
    if (!b.is_active) continue;
    if (b.number_id && opts.numberId && b.number_id !== opts.numberId) continue;
    if (b.hours_rule === "inside" && !opts.insideHours) continue;
    if (b.hours_rule === "outside" && opts.insideHours) continue;
    const kw = botMatches(b, text);
    if (kw) return { bot: b, keyword: kw };
  }
  return null;
}

/** Is `at` inside business hours? Always true when business hours are off. */
export function insideHours(p: Pick<WaPrefs, "hours_enabled" | "hours_from" | "hours_to" | "hours_days" | "timezone">, at = new Date()) {
  if (!p.hours_enabled) return true;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: p.timezone || "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  }
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  if (!p.hours_days.includes(day)) return false;
  const now = Number(get("hour")) * 60 + Number(get("minute"));
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
  const from = toMin(p.hours_from), to = toMin(p.hours_to);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

export const fmtNum = (n: number | null | undefined) => new Intl.NumberFormat("en-IN").format(Number(n ?? 0));
export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "0%");
