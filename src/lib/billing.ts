import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "./supabase/server";

// Starter plan from leadboxs.in/pricing: ₹699/user/month, billed annually.
export const PLAN = {
  pricePerSeatInr: Number(process.env.LB_PRICE_PER_USER_INR ?? 8388),
  days: Number(process.env.LB_PLAN_DAYS ?? 365),
};

/** Active users billed for a company. Uses the service role: a lapsed admin can no longer read teammates. */
export async function activeSeats(companyId: string) {
  const { count } = await createAdminClient().from("lb_profiles").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("is_active", true);
  return Math.max(1, count ?? 1);
}

export const razorpayConfigured = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

async function rzp<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Razorpay ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export type PaymentLink = {
  id: string; short_url: string; status: string; amount: number; amount_paid: number; currency: string;
  notes: { company_id?: string; seats?: string; days?: string };
  payments?: { payment_id: string; status: string }[] | null;
};

export async function createPaymentLink(o: { companyId: string; seats: number; name: string; email: string; phone: string | null; callbackUrl: string }) {
  return rzp<PaymentLink>("/payment_links", {
    method: "POST",
    body: {
      amount: PLAN.pricePerSeatInr * o.seats * 100,
      currency: "INR",
      description: `Lead Box CRM — ${o.seats} user${o.seats > 1 ? "s" : ""}, ${PLAN.days} days`,
      customer: { name: o.name, email: o.email, ...(o.phone ? { contact: o.phone } : {}) },
      notify: { sms: false, email: false },
      notes: { company_id: o.companyId, seats: String(o.seats), days: String(PLAN.days) },
      callback_url: o.callbackUrl,
      callback_method: "get",
    },
  });
}

export const fetchPaymentLink = (id: string) => rzp<PaymentLink>(`/payment_links/${encodeURIComponent(id)}`);

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Signature Razorpay appends to the payment-link callback URL. */
export function verifyCallback(p: { linkId: string; refId: string; status: string; paymentId: string; signature: string }) {
  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!).update(`${p.linkId}|${p.refId}|${p.status}|${p.paymentId}`).digest("hex");
  return safeEqualHex(expected, p.signature);
}

export function verifyWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  return safeEqualHex(createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
}

/** Re-reads the link from Razorpay (never trusts the browser) and extends access once per payment. */
export async function settlePaymentLink(linkId: string) {
  const link = await fetchPaymentLink(linkId);
  const paid = link.payments?.find((p) => p.status === "captured");
  if (link.status !== "paid" || !paid || !link.notes.company_id) return false;
  const { error } = await createAdminClient().rpc("lb_record_payment", {
    p_id: paid.payment_id, p_company: link.notes.company_id, p_provider: "razorpay",
    p_amount_paise: link.amount_paid, p_currency: link.currency,
    p_seats: Number(link.notes.seats ?? 1), p_days: Number(link.notes.days ?? PLAN.days), p_raw: link,
  });
  if (error) throw error;
  return true;
}
