import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "./supabase/server";
import { decryptSecret } from "./util";
import { quotePdf, type PdfCompany } from "./quote-pdf";
import { cleanItems, type Quote } from "./quotes";
import { stateOfGstin, type Seller } from "./gst";

// Server side of quotations / invoices / payment links. Every lookup filters by
// company_id explicitly (the service role bypasses RLS).

export type QuoteSettings = PdfCompany & {
  quote_prefix: string; invoice_prefix: string; next_quote_no: number; next_invoice_no: number;
  default_tax_pct: number; quote_validity_days: number; terms: string;
  quote_status_id: string | null; auto_status_on_send: boolean; won_on_payment: boolean;
  rzp_key_id: string | null; has_rzp_secret: boolean; has_webhook_secret: boolean;
  state_code: string; pincode: string; esign_enabled: boolean; esign_status_id: string | null;
};

const DEFAULTS = {
  business_name: "", address: "", gstin: "", phone: "", email: "", bank_details: "", footer_note: "Thank you for your business!",
  quote_prefix: "QT-", invoice_prefix: "INV-", next_quote_no: 1, next_invoice_no: 1, default_tax_pct: 18, quote_validity_days: 15,
  terms: "", quote_status_id: null, auto_status_on_send: true, won_on_payment: true,
  state_code: "", pincode: "", esign_enabled: true,
};

/** Settings without secrets. Falls back to the company name when no business name is set. */
export async function quoteSettings(companyId: string): Promise<QuoteSettings> {
  const db = createAdminClient();
  const [{ data }, { data: co }] = await Promise.all([
    db.from("lb_quote_settings").select("*").eq("company_id", companyId).maybeSingle(),
    db.from("lb_companies").select("name").eq("id", companyId).maybeSingle(),
  ]);
  const r = (data ?? {}) as Record<string, unknown>;
  const pick = <K extends keyof typeof DEFAULTS>(k: K) => (r[k] ?? DEFAULTS[k]) as (typeof DEFAULTS)[K];
  return {
    business_name: pick("business_name") || co?.name || "", address: pick("address"), gstin: pick("gstin"), phone: pick("phone"), email: pick("email"),
    bank_details: pick("bank_details"), footer_note: pick("footer_note"), quote_prefix: pick("quote_prefix"), invoice_prefix: pick("invoice_prefix"),
    next_quote_no: Number(pick("next_quote_no")), next_invoice_no: Number(pick("next_invoice_no")), default_tax_pct: Number(pick("default_tax_pct")),
    quote_validity_days: Number(pick("quote_validity_days")), terms: pick("terms"), quote_status_id: (r.quote_status_id as string | null) ?? null,
    auto_status_on_send: pick("auto_status_on_send"), won_on_payment: pick("won_on_payment"),
    rzp_key_id: (r.rzp_key_id as string | null) ?? null, has_rzp_secret: Boolean(r.rzp_key_secret_enc), has_webhook_secret: Boolean(r.rzp_webhook_secret_enc),
    state_code: pick("state_code") ?? "", pincode: pick("pincode") ?? "", esign_enabled: pick("esign_enabled") !== false,
    esign_status_id: (r.esign_status_id as string | null) ?? null,
  };
}

/** HSN / unit last used per item name (lower-case), so the editor can pre-fill them. */
export async function hsnMemory(companyId: string) {
  const { data } = await createAdminClient().from("lb_quotes").select("items").eq("company_id", companyId).order("created_at", { ascending: false }).limit(300);
  const out: Record<string, { hsn?: string; unit?: string }> = {};
  for (const r of data ?? []) for (const i of cleanItems(r.items)) {
    const k = i.name.trim().toLowerCase();
    if (!out[k] && (i.hsn || i.unit)) out[k] = { hsn: i.hsn, unit: i.unit };
  }
  return out;
}

/** The seller block used by GST returns and e-invoices. */
export const sellerOf = (s: QuoteSettings): Seller => ({
  gstin: s.gstin.trim().toUpperCase(), state: (/^\d{2}$/.test(s.state_code) ? s.state_code : null) ?? stateOfGstin(s.gstin),
  name: s.business_name, address: s.address, pincode: s.pincode, phone: s.phone, email: s.email,
});

/**
 * Fingerprint of what the customer agrees to: number, dates, buyer, items, totals and
 * terms. Stored with the signature so a later edit of the quotation is detectable.
 */
export const quoteFingerprint = (q: Quote) => createHash("sha256").update(JSON.stringify({
  doc_no: q.doc_no, kind: q.kind, issue_date: q.issue_date, valid_until: q.valid_until, items: q.items,
  subtotal: q.subtotal, discount: q.discount, tax_total: q.tax_total, total: q.total, notes: q.notes, terms: q.terms,
  buyer_gstin: q.buyer_gstin ?? null, place_of_supply: q.place_of_supply ?? null,
})).digest("hex");

export const normQuote = (q: Record<string, unknown>): Quote => ({
  ...(q as unknown as Quote),
  items: cleanItems(q.items), subtotal: Number(q.subtotal), discount: Number(q.discount), tax_total: Number(q.tax_total),
  total: Number(q.total), amount_paid: Number(q.amount_paid),
});

/** PDF bytes + file name for a quotation/invoice of the given company. */
export async function renderQuote(quoteId: string, companyId: string) {
  const db = createAdminClient();
  const { data: q } = await db.from("lb_quotes").select("*").eq("id", quoteId).eq("company_id", companyId).maybeSingle();
  if (!q) return null;
  const { data: lead } = await db.from("lb_leads").select("lead_no, customer:lb_customers(name,phone_e164,email,location)").eq("id", q.lead_id).maybeSingle();
  const c = (lead?.customer ?? {}) as unknown as { name: string | null; phone_e164: string; email: string | null; location: string | null };
  const quote = normQuote(q);
  const sig = quote.signed_at
    ? (await db.from("lb_quote_signatures").select("signer_name,signature_png,doc_hash,ip,signed_at").eq("quote_id", quote.id).eq("company_id", companyId).maybeSingle()).data
    : null;
  const settings = await quoteSettings(companyId);
  const bytes = await quotePdf(quote, settings, { name: c.name, phone: c.phone_e164 ?? "", email: c.email, location: c.location }, lead?.lead_no ?? "",
    { seller: sellerOf(settings), signature: sig ? { ...sig, current_hash: quoteFingerprint(quote) } : null });
  return { bytes, fileName: `${quote.doc_no.replace(/[^\w.-]/g, "_")}.pdf`, quote };
}

// ------------------------------------------------------------- Razorpay
// Each company uses its OWN Razorpay account, so customers pay the company directly.

type Keys = { keyId: string; secret: string; webhookSecret: string | null };

export async function companyRazorpay(companyId: string): Promise<Keys | null> {
  const { data } = await createAdminClient().from("lb_quote_settings").select("rzp_key_id,rzp_key_secret_enc,rzp_webhook_secret_enc").eq("company_id", companyId).maybeSingle();
  if (!data?.rzp_key_id || !data.rzp_key_secret_enc) return null;
  try {
    return { keyId: data.rzp_key_id, secret: decryptSecret(data.rzp_key_secret_enc), webhookSecret: data.rzp_webhook_secret_enc ? decryptSecret(data.rzp_webhook_secret_enc) : null };
  } catch {
    return null; // LB_SECRETS_KEY changed: keys must be saved again
  }
}

export async function rzpCall<T>(k: Pick<Keys, "keyId" | "secret">, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${k.keyId}:${k.secret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new Error(json.error?.description || `Razorpay error ${res.status}`);
  return json;
}

export type RzpLink = {
  id: string; short_url: string; status: string; amount: number; amount_paid: number; reference_id?: string;
  notes?: Record<string, string>; payments?: { payment_id: string; status: string; amount: number }[] | null;
};

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};
export const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
export const verifyHmac = (secret: string, data: string, sig: string | null) => Boolean(sig) && safeEqualHex(hmacHex(secret, data), sig!);

/**
 * Re-reads a payment link from Razorpay with the company's keys (never trusts the
 * browser or webhook body) and settles it in the CRM. Returns the new status.
 */
export async function syncPaymentLink(rowId: string, companyId: string): Promise<{ status?: string; error?: string }> {
  const db = createAdminClient();
  const { data: row } = await db.from("lb_payment_links").select("id,provider_link_id,status").eq("id", rowId).eq("company_id", companyId).maybeSingle();
  if (!row?.provider_link_id) return { error: "Payment link not found" };
  const keys = await companyRazorpay(companyId);
  if (!keys) return { error: "Razorpay keys are not set for this company." };
  const link = await rzpCall<RzpLink>(keys, `/payment_links/${encodeURIComponent(row.provider_link_id)}`);
  const captured = link.payments?.find((p) => p.status === "captured");
  if ((link.status === "paid" || link.status === "partially_paid") && captured) {
    const { error } = await db.rpc("lb_settle_lead_payment", { p_link: row.id, p_payment_id: captured.payment_id, p_amount_paise: link.amount_paid, p_status: link.status });
    if (error) throw error;
    return { status: link.status };
  }
  if (["cancelled", "expired"].includes(link.status) && row.status === "created") {
    await db.from("lb_payment_links").update({ status: link.status, updated_at: new Date().toISOString() }).eq("id", row.id).eq("company_id", companyId);
  }
  return { status: link.status };
}
