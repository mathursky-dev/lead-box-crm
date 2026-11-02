// Field force (attendance, visits, expenses) constants shared by pages, the /field app and the sync API.

export const EXPENSE_CATEGORIES = [
  { value: "travel", label: "Travel (bus, cab, auto, train)" },
  { value: "fuel", label: "Fuel / own vehicle" },
  { value: "food", label: "Food" },
  { value: "stay", label: "Hotel / stay" },
  { value: "client", label: "Client meeting" },
  { value: "phone", label: "Phone / internet" },
  { value: "other", label: "Other" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];
export const categoryLabel = (v: string) => EXPENSE_CATEGORIES.find((c) => c.value === v)?.label.replace(/ \(.*\)$/, "") ?? v;

export const EXPENSE_STATUSES = [
  { value: "pending", label: "Pending", cls: "bg-amber-100 text-amber-800" },
  { value: "approved", label: "Approved", cls: "bg-emerald-100 text-emerald-800" },
  { value: "rejected", label: "Rejected", cls: "bg-red-100 text-red-700" },
  { value: "paid", label: "Paid", cls: "bg-sky-100 text-sky-800" },
] as const;
export const expenseStatusOf = (v: string) => EXPENSE_STATUSES.find((s) => s.value === v) ?? EXPENSE_STATUSES[0];

export const VISIT_OUTCOMES = [
  { value: "interested", label: "Interested" },
  { value: "follow_up", label: "Follow-up needed" },
  { value: "order", label: "Order received" },
  { value: "not_interested", label: "Not interested" },
  { value: "not_met", label: "Customer not met" },
  { value: "other", label: "Other" },
] as const;
export const outcomeLabel = (v: string | null) => VISIT_OUTCOMES.find((o) => o.value === v)?.label ?? "—";

/** Google Maps link for a point (no API key needed). */
export const mapUrl = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;

export const rupees = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** "3h 25m" from minutes. */
export const fmtHours = (min: number) => {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const FIELD_BUCKET = "lb-field";

// ── Offline queue items (saved on the phone, sent to /api/field/sync one by one) ──
export type GeoPoint = { lat: number; lng: number; acc: number } | null;
export type QueueItem =
  | { kind: "checkin"; client_id: string; at: string; geo: GeoPoint; note?: string }
  | { kind: "checkout"; client_id: string; at: string; geo: GeoPoint; note?: string }
  | { kind: "visit_start"; client_id: string; at: string; geo: GeoPoint; lead_id?: string | null; customer_name?: string; purpose?: string }
  | { kind: "visit_end"; client_id: string; at: string; geo: GeoPoint; outcome: string; notes?: string; followup_at?: string | null; lead_id?: string | null }
  | { kind: "expense"; client_id: string; date: string; category: string; amount: number; km?: number | null; description?: string; lead_id?: string | null; visit_client_id?: string | null }
  | { kind: "lead"; client_id: string; name?: string; phone: string; notes?: string }
  | { kind: "note"; client_id: string; lead_id: string; body: string };

export const QUEUE_LABEL: Record<QueueItem["kind"], string> = {
  checkin: "Check-in", checkout: "Check-out", visit_start: "Visit started", visit_end: "Visit report",
  expense: "Expense", lead: "New lead", note: "Lead note",
};
