// Shared (client + server) bits of loyalty points, service tickets, renewals and wishes.

export const TICKET_STATUSES = [
  { value: "open", label: "Open", cls: "bg-amber-100 text-amber-800" },
  { value: "in_progress", label: "In progress", cls: "bg-blue-100 text-blue-800" },
  { value: "waiting", label: "Waiting on customer", cls: "bg-violet-100 text-violet-800" },
  { value: "resolved", label: "Resolved", cls: "bg-green-100 text-green-800" },
  { value: "closed", label: "Closed", cls: "bg-slate-200 text-slate-600" },
] as const;
export const ticketStatus = (v: string) => TICKET_STATUSES.find((s) => s.value === v) ?? TICKET_STATUSES[0];
export const OPEN_TICKET = ["open", "in_progress", "waiting"];

export const TICKET_PRIORITIES = [
  { value: "urgent", label: "Urgent", cls: "bg-red-100 text-red-700" },
  { value: "high", label: "High", cls: "bg-orange-100 text-orange-800" },
  { value: "normal", label: "Normal", cls: "bg-slate-100 text-slate-700" },
  { value: "low", label: "Low", cls: "bg-slate-50 text-slate-500" },
] as const;
export const ticketPriority = (v: string) => TICKET_PRIORITIES.find((s) => s.value === v) ?? TICKET_PRIORITIES[2];

export const RENEWAL_KINDS = [
  { value: "amc", label: "AMC" }, { value: "subscription", label: "Subscription" }, { value: "warranty", label: "Warranty" },
  { value: "service", label: "Service due" }, { value: "insurance", label: "Insurance" }, { value: "other", label: "Other" },
] as const;
export const renewalKind = (v: string) => RENEWAL_KINDS.find((k) => k.value === v)?.label ?? "Other";

export const RENEWAL_STATUSES: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-green-100 text-green-800" },
  lapsed: { label: "Lapsed", cls: "bg-red-100 text-red-700" },
  renewed: { label: "Renewed", cls: "bg-violet-100 text-violet-800" },
  cancelled: { label: "Cancelled", cls: "bg-slate-200 text-slate-600" },
};

export const LEDGER_SOURCE: Record<string, string> = {
  won: "Purchase", order: "Store order", redeem: "Redeemed", adjust: "Adjusted", expire: "Expired", birthday: "Birthday bonus",
};

export const RETENTION_RESULT = (r: string) =>
  r === "sent" ? { label: "WhatsApp sent", cls: "bg-green-100 text-green-800" }
    : r === "notified" ? { label: "Owner reminded", cls: "bg-blue-100 text-blue-800" }
      : r === "done" ? { label: "Done", cls: "bg-slate-100 text-slate-700" }
        : { label: `Not sent · ${r.replace(/^skipped:/, "").replaceAll("_", " ")}`, cls: "bg-amber-100 text-amber-800" };

export type RetentionSettings = {
  loyalty_enabled: boolean; points_per_100: number; point_value: number; min_redeem: number; max_redeem_pct: number;
  earn_on_won: boolean; earn_on_orders: boolean; expiry_months: number | null; birthday_points: number;
  ticket_categories: string[]; sla_response_hours: Record<string, number>; sla_resolve_hours: Record<string, number>;
  tickets_from_complaints: boolean; portal_tickets: boolean; ticket_wa_updates: boolean; auto_close_days: number;
  renewal_remind_days: number[]; renewal_lapse_days: number; renewal_auto_wa: boolean;
  renewal_number_id: string | null; renewal_template: string | null; renewal_template_lang: string | null;
  wishes_enabled: boolean; wish_notify_owner: boolean; wish_hour: number; wish_number_id: string | null;
  birthday_template: string | null; birthday_template_lang: string | null; anniversary_template: string | null; anniversary_template_lang: string | null;
};
export const RET_COLS = "loyalty_enabled,points_per_100,point_value,min_redeem,max_redeem_pct,earn_on_won,earn_on_orders,expiry_months,birthday_points,ticket_categories,sla_response_hours,sla_resolve_hours,tickets_from_complaints,portal_tickets,ticket_wa_updates,auto_close_days,renewal_remind_days,renewal_lapse_days,renewal_auto_wa,renewal_number_id,renewal_template,renewal_template_lang,wishes_enabled,wish_notify_owner,wish_hour,wish_number_id,birthday_template,birthday_template_lang,anniversary_template,anniversary_template_lang";

export const RET_DEFAULTS: RetentionSettings = {
  loyalty_enabled: false, points_per_100: 1, point_value: 1, min_redeem: 100, max_redeem_pct: 50, earn_on_won: true, earn_on_orders: true,
  expiry_months: null, birthday_points: 0,
  ticket_categories: ["Installation", "Repair", "Service", "Billing", "Delivery", "Product quality", "Other"],
  sla_response_hours: { urgent: 1, high: 4, normal: 8, low: 24 }, sla_resolve_hours: { urgent: 8, high: 24, normal: 72, low: 168 },
  tickets_from_complaints: true, portal_tickets: true, ticket_wa_updates: false, auto_close_days: 7,
  renewal_remind_days: [30, 7, 1, 0], renewal_lapse_days: 30, renewal_auto_wa: false, renewal_number_id: null, renewal_template: null, renewal_template_lang: null,
  wishes_enabled: false, wish_notify_owner: true, wish_hour: 10, wish_number_id: null,
  birthday_template: null, birthday_template_lang: null, anniversary_template: null, anniversary_template_lang: null,
};

/** "2h 05m" style countdown / overdue label for an SLA deadline. */
export function slaLabel(due: string | null, now: number) {
  if (!due) return null;
  const ms = new Date(due).getTime() - now, abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000), m = Math.floor((abs % 3600000) / 60000), d = Math.floor(h / 24);
  const t = d >= 2 ? `${d}d` : h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  return { late: ms < 0, text: ms < 0 ? `${t} overdue` : `${t} left` };
}

/** Whole days from today (IST) to a YYYY-MM-DD date; negative = overdue. */
export function daysUntil(ymd: string, now: number) {
  const today = new Date(now + 330 * 60000).toISOString().slice(0, 10);
  return Math.round((Date.parse(ymd) - Date.parse(today)) / 86400000);
}

export const fmtYmd = (ymd: string | null | undefined) =>
  ymd ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`)) : "—";
