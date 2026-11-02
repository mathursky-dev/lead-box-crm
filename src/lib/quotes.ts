// Quotations / invoices: shared types and money maths (used by the browser builder,
// server actions and the PDF). No server-only imports here.

export type QuoteKind = "quotation" | "invoice";
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "paid" | "cancelled";
export type QuoteItem = { name: string; description: string; qty: number; rate: number; tax_pct: number };

export type Quote = {
  id: string; company_id: string; lead_id: string; kind: QuoteKind; doc_no: string; status: QuoteStatus;
  issue_date: string; valid_until: string | null; items: QuoteItem[]; subtotal: number; discount: number;
  tax_total: number; total: number; amount_paid: number; notes: string; terms: string; from_quote_id: string | null;
  public_token: string; sent_at: string | null; paid_at: string | null; created_at: string;
};

export type PayLink = {
  id: string; lead_id: string; quote_id: string | null; amount: number; description: string; short_url: string | null;
  status: "created" | "paid" | "partially_paid" | "cancelled" | "expired" | "failed"; amount_paid: number;
  paid_at: string | null; sent_at: string | null; created_at: string;
};

export const KIND_LABEL: Record<QuoteKind, string> = { quotation: "Quotation", invoice: "Invoice" };

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-700" },
  sent: { label: "Sent", cls: "bg-sky-50 text-sky-700" },
  accepted: { label: "Accepted", cls: "bg-violet-50 text-violet-700" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700" },
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500 line-through" },
};

export const LINK_STATUS: Record<PayLink["status"], { label: string; cls: string }> = {
  created: { label: "Awaiting payment", cls: "bg-amber-50 text-amber-800" },
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700" },
  partially_paid: { label: "Part paid", cls: "bg-violet-50 text-violet-700" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500" },
  expired: { label: "Expired", cls: "bg-slate-100 text-slate-500" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700" },
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const clampNum = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || 0));

/** Cleans line items coming from the browser. Empty rows are dropped. */
export function cleanItems(raw: unknown): QuoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? "").trim().slice(0, 200),
      description: String(o.description ?? "").trim().slice(0, 1000),
      qty: r2(clampNum(o.qty, 0, 1_000_000)),
      rate: r2(clampNum(o.rate, 0, 1_000_000_000)),
      tax_pct: r2(clampNum(o.tax_pct, 0, 100)),
    };
  }).filter((i) => i.name);
}

/** Line amount before tax. */
export const lineAmount = (i: QuoteItem) => r2(i.qty * i.rate);

/**
 * Totals. The discount is a flat amount taken off before tax, spread over the
 * lines in proportion to their value so each line's GST stays correct.
 */
export function totals(items: QuoteItem[], discount: number) {
  const subtotal = r2(items.reduce((s, i) => s + lineAmount(i), 0));
  const disc = r2(Math.min(Math.max(0, Number(discount) || 0), subtotal));
  const tax = r2(items.reduce((s, i) => {
    const base = lineAmount(i);
    const share = subtotal > 0 ? base - (disc * base) / subtotal : 0;
    return s + (share * i.tax_pct) / 100;
  }, 0));
  return { subtotal, discount: disc, tax_total: tax, total: r2(subtotal - disc + tax) };
}

export const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
