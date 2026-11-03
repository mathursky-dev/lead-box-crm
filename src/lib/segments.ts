// Automatic customer segments (see migration 20261102190000_lb_customer_segments.sql).
// Purchases = store orders (confirmed+ or paid) + paid invoices + won deals not already counted.

export type SmartKey = "vip" | "repeat" | "new_buyer" | "one_time" | "at_risk" | "inactive" | "never_bought" | "birthday_month";
export const SMART_KEYS: SmartKey[] = ["vip", "repeat", "new_buyer", "one_time", "at_risk", "inactive", "never_bought", "birthday_month"];

export type SegmentSettings = {
  vip_min_spend: number; vip_min_orders: number; repeat_min_orders: number;
  new_buyer_days: number; at_risk_days: number; inactive_days: number;
};
export const DEFAULT_SEGMENT_SETTINGS: SegmentSettings = {
  vip_min_spend: 25000, vip_min_orders: 5, repeat_min_orders: 2, new_buyer_days: 30, at_risk_days: 90, inactive_days: 60,
};

export const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export const SMART: Record<SmartKey, { label: string; icon: string; tone: string; rule: (s: SegmentSettings) => string; idea: string }> = {
  vip: { label: "VIP customers", icon: "trophy", tone: "bg-amber-50 text-amber-700",
    rule: (s) => `Spent ${inr(s.vip_min_spend)}+ or bought ${s.vip_min_orders}+ times`, idea: "Early access, special price, thank-you note" },
  repeat: { label: "Repeat buyers", icon: "refresh", tone: "bg-emerald-50 text-emerald-700",
    rule: (s) => `Bought ${s.repeat_min_orders} or more times`, idea: "New arrivals, loyalty points, referral ask" },
  new_buyer: { label: "New buyers", icon: "sparkle", tone: "bg-sky-50 text-sky-700",
    rule: (s) => `First purchase in the last ${s.new_buyer_days} days`, idea: "Welcome, how-to-use, review request" },
  one_time: { label: "One-time buyers", icon: "user", tone: "bg-violet-50 text-violet-700",
    rule: () => "Bought exactly once", idea: "Second-purchase offer" },
  at_risk: { label: "At risk", icon: "alert", tone: "bg-rose-50 text-rose-700",
    rule: (s) => `Bought before, nothing in ${s.at_risk_days} days`, idea: "We miss you offer" },
  inactive: { label: "Inactive", icon: "clock", tone: "bg-slate-100 text-slate-700",
    rule: (s) => `No message or purchase in ${s.inactive_days} days`, idea: "Re-engagement message" },
  never_bought: { label: "Never bought", icon: "target", tone: "bg-orange-50 text-orange-700",
    rule: () => "Leads who have not bought yet (won/order/paid invoice)", idea: "Demo, first-order discount" },
  birthday_month: { label: "Birthday this month", icon: "gift", tone: "bg-pink-50 text-pink-700",
    rule: () => "Birthday saved on the customer, falls this month", idea: "Birthday wish + gift coupon" },
};

export const isSmartKey = (k: unknown): k is SmartKey => typeof k === "string" && (SMART_KEYS as string[]).includes(k);
