"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, isAdmin, can } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { encryptSecret, errMsg } from "@/lib/util";
import { enqueue } from "@/lib/inbox-send";
import { openLeadChat } from "@/lib/actions/leads";
import { cleanItems, totals, inr, KIND_LABEL, type QuoteKind } from "@/lib/quotes";
import { companyRazorpay, renderQuote, rzpCall, syncPaymentLink, type RzpLink } from "@/lib/quotes-server";
import type { FormState } from "@/components/ui";

// Quotations, invoices and Razorpay payment links. Writes use the service role,
// always after checking (with the user's own RLS) that the caller can see the lead.

type Result = { error?: string; ok?: boolean };
const Uuid = z.uuid();
const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);

async function visibleLead(leadId: string) {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(leadId).success) return { error: "Invalid lead" } as const;
  if (!hasServiceRole()) return { error: "The server is not configured (service role key)." } as const;
  const { data: lead } = await (await createClient()).from("lb_leads").select("id,company_id,customer_id,lead_no")
    .eq("id", leadId).eq("company_id", profile.company_id).maybeSingle();
  if (!lead) return { error: "Lead not found" } as const;
  return { profile, lead };
}

async function visibleQuote(id: string) {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid quotation" } as const;
  const { data: q } = await (await createClient()).from("lb_quotes").select("*").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!q) return { error: "Quotation not found" } as const;
  return { profile, q };
}

const touch = (leadId: string, id?: string) => {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/quotes");
  if (id) revalidatePath(`/quotes/${id}`);
};

// ------------------------------------------------------------ quotes
export type QuoteInput = {
  id?: string; lead_id: string; kind: QuoteKind; issue_date: string; valid_until: string | null;
  items: unknown; discount: number; notes: string; terms: string;
};

export async function saveQuote(input: QuoteInput): Promise<Result & { id?: string }> {
  const v = await visibleLead(input.lead_id);
  if ("error" in v) return { error: v.error };
  const kind: QuoteKind = input.kind === "invoice" ? "invoice" : "quotation";
  const items = cleanItems(input.items);
  if (!items.length) return { error: "Add at least one item with a name." };
  const t = totals(items, input.discount);
  const row = {
    items, ...t, issue_date: ymd(input.issue_date) ?? new Date().toISOString().slice(0, 10), valid_until: ymd(input.valid_until),
    notes: String(input.notes ?? "").slice(0, 3000), terms: String(input.terms ?? "").slice(0, 5000), updated_at: new Date().toISOString(),
  };
  const db = createAdminClient();
  if (input.id) {
    const o = await visibleQuote(input.id);
    if ("error" in o) return { error: o.error };
    if (["paid", "cancelled"].includes(o.q.status)) return { error: `A ${o.q.status} ${KIND_LABEL[o.q.kind as QuoteKind].toLowerCase()} can't be edited.` };
    if (o.q.amount_paid > 0 && t.total < Number(o.q.amount_paid)) return { error: "Total can't be less than the amount already paid." };
    const { error } = await db.from("lb_quotes").update(row).eq("id", input.id).eq("company_id", v.profile.company_id);
    if (error) return { error: errMsg(error) };
    touch(input.lead_id, input.id);
    return { ok: true, id: input.id };
  }
  const { data: docNo, error: e1 } = await db.rpc("lb_next_doc_no", { p_company: v.profile.company_id, p_kind: kind });
  if (e1 || !docNo) return { error: e1 ? errMsg(e1) : "Could not number the document" };
  const { data, error } = await db.from("lb_quotes").insert({
    ...row, company_id: v.profile.company_id, lead_id: v.lead.id, customer_id: v.lead.customer_id, kind, doc_no: docNo, created_by: v.profile.id,
  }).select("id").single();
  if (error) return { error: errMsg(error) };
  touch(input.lead_id, data.id);
  return { ok: true, id: data.id };
}

export async function setQuoteStatus(id: string, status: "accepted" | "rejected" | "cancelled" | "sent"): Promise<FormState> {
  if (!["accepted", "rejected", "cancelled", "sent"].includes(status)) return { error: "Invalid status" };
  const o = await visibleQuote(id);
  if ("error" in o) return { error: o.error };
  if (o.q.status === "paid") return { error: "Already paid." };
  const { error } = await createAdminClient().from("lb_quotes").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("company_id", o.profile.company_id);
  if (error) return { error: errMsg(error) };
  touch(o.q.lead_id, id);
  return { ok: "Saved" };
}

export async function deleteQuote(id: string): Promise<FormState> {
  const o = await visibleQuote(id);
  if ("error" in o) return { error: o.error };
  if (o.q.status !== "draft" && !isAdmin(o.profile)) return { error: "Only drafts can be deleted. Cancel it instead." };
  if (Number(o.q.amount_paid) > 0) return { error: "A document with payments can't be deleted." };
  const { error } = await createAdminClient().from("lb_quotes").delete().eq("id", id).eq("company_id", o.profile.company_id);
  if (error) return { error: errMsg(error) };
  touch(o.q.lead_id);
  return { ok: "Deleted" };
}

/** Quotation -> new draft invoice with the same items. */
export async function convertToInvoice(id: string): Promise<Result & { id?: string }> {
  const o = await visibleQuote(id);
  if ("error" in o) return { error: o.error };
  if (o.q.kind !== "quotation") return { error: "This is already an invoice." };
  const { data: existing } = await createAdminClient().from("lb_quotes").select("id").eq("from_quote_id", id).eq("company_id", o.profile.company_id).neq("status", "cancelled").limit(1).maybeSingle();
  if (existing) return { ok: true, id: existing.id };
  const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const r = await saveQuote({ lead_id: o.q.lead_id, kind: "invoice", issue_date: new Date().toISOString().slice(0, 10), valid_until: due,
    items: o.q.items, discount: Number(o.q.discount), notes: o.q.notes, terms: o.q.terms });
  if (r.id) {
    await createAdminClient().from("lb_quotes").update({ from_quote_id: id }).eq("id", r.id).eq("company_id", o.profile.company_id);
    if (o.q.status === "sent" || o.q.status === "draft") await createAdminClient().from("lb_quotes").update({ status: "accepted" }).eq("id", id).eq("company_id", o.profile.company_id);
  }
  return r;
}

/** Marks as sent without WhatsApp (shared by email/link). Also applies the "Quotation sent" status. */
export async function markQuoteSent(id: string): Promise<FormState> {
  const o = await visibleQuote(id);
  if ("error" in o) return { error: o.error };
  const { data, error } = await createAdminClient().rpc("lb_quote_mark_sent", { p_quote: id, p_actor: o.profile.id });
  if (error) return { error: errMsg(error) };
  touch(o.q.lead_id, id);
  return { ok: data ? `Marked as sent. Lead moved to "${data}".` : "Marked as sent." };
}

/** Builds the PDF, attaches it to the lead's WhatsApp chat and marks the document sent. */
export async function sendQuoteOnWhatsApp(id: string, caption?: string): Promise<FormState> {
  const o = await visibleQuote(id);
  if ("error" in o) return { error: o.error };
  if (!can(o.profile, "chats.send")) return { error: "You don't have permission to send WhatsApp messages." };
  if (o.q.status === "cancelled") return { error: "This document is cancelled." };
  const chat = await openLeadChat(o.q.lead_id);
  if (chat.error || !chat.id) return { error: chat.error ?? "No WhatsApp chat for this lead." };
  const pdf = await renderQuote(id, o.profile.company_id);
  if (!pdf) return { error: "Quotation not found" };
  const path = `${o.profile.company_id}/${chat.id}/${randomUUID()}-${pdf.fileName}`;
  const db = createAdminClient();
  const { error: upErr } = await db.storage.from("lb-media").upload(path, pdf.bytes, { contentType: "application/pdf" });
  if (upErr) return { error: `Could not save the PDF: ${upErr.message}` };
  const label = KIND_LABEL[o.q.kind as QuoteKind];
  const body = (caption ?? "").trim() || `${label} ${o.q.doc_no} — Total ${inr(Number(o.q.total))}`;
  const r = await enqueue(chat.id, randomUUID(), { type: "document", media_path: path, media_mime: "application/pdf", media_filename: pdf.fileName, body: body.slice(0, 1024) });
  if (r.error && !r.ok) {
    await db.storage.from("lb-media").remove([path]);
    return { error: /24-hour/.test(r.error) ? "WhatsApp 24-hour window is closed for this customer, so a PDF can't be sent right now. Send a template first, or copy the share link and send it with a template." : r.error };
  }
  const { data: moved, error } = await db.rpc("lb_quote_mark_sent", { p_quote: id, p_actor: o.profile.id });
  touch(o.q.lead_id, id);
  if (error) return { ok: "Sent on WhatsApp.", error: `Sent, but status not updated: ${errMsg(error)}` };
  return { ok: moved ? `Sent on WhatsApp. Lead moved to "${moved}".` : "Sent on WhatsApp." };
}

// ----------------------------------------------------- payment links
export async function createPaymentLink(input: { lead_id: string; quote_id?: string | null; amount: number; description: string; send: boolean }): Promise<Result & { url?: string; sent?: boolean; warn?: string }> {
  const v = await visibleLead(input.lead_id);
  if ("error" in v) return { error: v.error };
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (!(amount >= 1)) return { error: "Amount must be at least ₹1." };
  if (amount > 5_000_000) return { error: "Amount is too large for a payment link." };
  const keys = await companyRazorpay(v.profile.company_id);
  if (!keys) return { error: isAdmin(v.profile) ? "Add your Razorpay keys first: Settings → Quotes & Payments." : "Razorpay is not set up yet. Ask your admin to add the keys in Settings → Quotes & Payments." };
  const db = createAdminClient();
  let quoteId: string | null = null;
  if (input.quote_id) {
    const { data: q } = await db.from("lb_quotes").select("id,lead_id").eq("id", input.quote_id).eq("company_id", v.profile.company_id).maybeSingle();
    if (!q || q.lead_id !== v.lead.id) return { error: "Quotation not found" };
    quoteId = q.id;
  }
  const description = String(input.description ?? "").trim().slice(0, 200) || `Payment for LB-${v.lead.lead_no}`;
  const { data: row, error } = await db.from("lb_payment_links").insert({
    company_id: v.profile.company_id, lead_id: v.lead.id, quote_id: quoteId, amount, description, created_by: v.profile.id,
  }).select("id").single();
  if (error) return { error: errMsg(error) };
  const { data: cust } = await db.from("lb_customers").select("name,phone_e164,email").eq("id", v.lead.customer_id).maybeSingle();
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  let link: RzpLink;
  try {
    link = await rzpCall<RzpLink>(keys, "/payment_links", { method: "POST", body: {
      amount: Math.round(amount * 100), currency: "INR", description, reference_id: row.id,
      customer: { ...(cust?.name ? { name: cust.name.slice(0, 100) } : {}), ...(cust?.phone_e164 ? { contact: cust.phone_e164 } : {}), ...(cust?.email ? { email: cust.email } : {}) },
      notify: { sms: false, email: false }, reminder_enable: true,
      notes: { company_id: v.profile.company_id, lead_id: v.lead.id, lb_link: row.id },
      ...(base ? { callback_url: `${base}/api/pay/razorpay/callback?c=${v.profile.company_id}`, callback_method: "get" } : {}),
    } });
  } catch (e) {
    await db.from("lb_payment_links").update({ status: "failed" }).eq("id", row.id);
    return { error: `Razorpay: ${errMsg(e)}` };
  }
  await db.from("lb_payment_links").update({ provider_link_id: link.id, short_url: link.short_url, updated_at: new Date().toISOString() }).eq("id", row.id);
  revalidatePath(`/leads/${v.lead.id}`);
  if (!input.send) return { ok: true, url: link.short_url };
  const sent = await sendPaymentLink(row.id);
  return { ok: true, url: link.short_url, sent: !sent?.error, warn: sent?.error };
}

/** Sends (or re-sends) a payment link as a WhatsApp text in the lead's chat. */
export async function sendPaymentLink(id: string): Promise<FormState> {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid link" };
  if (!can(profile, "chats.send")) return { error: "You don't have permission to send WhatsApp messages." };
  const { data: pl } = await (await createClient()).from("lb_payment_links").select("id,lead_id,amount,description,short_url,status")
    .eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!pl?.short_url) return { error: "Payment link not found" };
  if (pl.status !== "created") return { error: `This link is ${pl.status}.` };
  const chat = await openLeadChat(pl.lead_id);
  if (chat.error || !chat.id) return { error: chat.error ?? "No WhatsApp chat for this lead." };
  const body = `${pl.description}\nAmount: ${inr(Number(pl.amount))}\n\nPay securely here: ${pl.short_url}`;
  const r = await enqueue(chat.id, randomUUID(), { type: "text", body });
  if (r.error && !r.ok) return { error: /24-hour/.test(r.error) ? "WhatsApp 24-hour window is closed, so the link wasn't sent. Copy the link and send it with a template." : r.error };
  await createAdminClient().from("lb_payment_links").update({ sent_at: new Date().toISOString() }).eq("id", id).eq("company_id", profile.company_id);
  revalidatePath(`/leads/${pl.lead_id}`);
  return { ok: "Payment link sent on WhatsApp." };
}

/** Asks Razorpay for the latest status (in case the webhook isn't set up). */
export async function refreshPaymentLink(id: string): Promise<FormState> {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid link" };
  const { data: pl } = await (await createClient()).from("lb_payment_links").select("id,lead_id").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!pl) return { error: "Payment link not found" };
  try {
    const r = await syncPaymentLink(id, profile.company_id);
    if (r.error) return { error: r.error };
    revalidatePath(`/leads/${pl.lead_id}`);
    return { ok: `Status: ${r.status}` };
  } catch (e) { return { error: errMsg(e) }; }
}

export async function cancelPaymentLink(id: string): Promise<FormState> {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid link" };
  const { data: pl } = await (await createClient()).from("lb_payment_links").select("id,lead_id,provider_link_id,status").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!pl) return { error: "Payment link not found" };
  if (pl.status !== "created") return { error: `This link is already ${pl.status}.` };
  const keys = await companyRazorpay(profile.company_id);
  if (keys && pl.provider_link_id) {
    try { await rzpCall(keys, `/payment_links/${encodeURIComponent(pl.provider_link_id)}/cancel`, { method: "POST" }); }
    catch (e) { return { error: `Razorpay: ${errMsg(e)}` }; }
  }
  await createAdminClient().from("lb_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("company_id", profile.company_id);
  revalidatePath(`/leads/${pl.lead_id}`);
  return { ok: "Cancelled" };
}

// ---------------------------------------------------------- settings
const s = (v: FormDataEntryValue | null, max = 500) => String(v ?? "").trim().slice(0, max);

export async function saveQuoteSettings(_: FormState, form: FormData): Promise<FormState> {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return { error: "Only admins can change these settings." };
  const statusId = s(form.get("quote_status_id"), 40);
  if (statusId) {
    const { data } = await (await createClient()).from("lb_lead_statuses").select("id").eq("id", statusId).eq("company_id", profile.company_id).maybeSingle();
    if (!data) return { error: "Invalid status" };
  }
  const num = (k: string, min: number, max: number, def: number) => {
    const n = Number(form.get(k));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : def;
  };
  const prefix = (k: string, def: string) => s(form.get(k), 12).replace(/[^\w\-/]/g, "") || def;
  const row = {
    company_id: profile.company_id,
    business_name: s(form.get("business_name"), 120), address: s(form.get("address"), 500), gstin: s(form.get("gstin"), 20).toUpperCase(),
    phone: s(form.get("phone"), 40), email: s(form.get("email"), 120), quote_prefix: prefix("quote_prefix", "QT-"), invoice_prefix: prefix("invoice_prefix", "INV-"),
    next_quote_no: Math.round(num("next_quote_no", 1, 9_999_999, 1)), next_invoice_no: Math.round(num("next_invoice_no", 1, 9_999_999, 1)),
    default_tax_pct: num("default_tax_pct", 0, 100, 18), quote_validity_days: Math.round(num("quote_validity_days", 0, 365, 15)),
    terms: s(form.get("terms"), 5000), bank_details: s(form.get("bank_details"), 1000), footer_note: s(form.get("footer_note"), 200),
    quote_status_id: statusId || null, auto_status_on_send: form.get("auto_status_on_send") === "on", won_on_payment: form.get("won_on_payment") === "on",
    updated_at: new Date().toISOString(),
  };
  const { error } = await createAdminClient().from("lb_quote_settings").upsert(row, { onConflict: "company_id" });
  if (error) return { error: errMsg(error) };
  revalidatePath("/settings/quotes");
  return { ok: "Saved" };
}

export async function saveRazorpayKeys(_: FormState, form: FormData): Promise<FormState> {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return { error: "Only admins can change payment keys." };
  if (!process.env.LB_SECRETS_KEY) return { error: "Server is not configured: LB_SECRETS_KEY is missing." };
  if (form.get("remove") === "1") {
    const { error } = await createAdminClient().from("lb_quote_settings").upsert({ company_id: profile.company_id, rzp_key_id: null, rzp_key_secret_enc: null, rzp_webhook_secret_enc: null }, { onConflict: "company_id" });
    if (error) return { error: errMsg(error) };
    revalidatePath("/settings/quotes");
    return { ok: "Razorpay keys removed." };
  }
  const keyId = s(form.get("key_id"), 60), secret = s(form.get("key_secret"), 100), hook = s(form.get("webhook_secret"), 100);
  const current = await companyRazorpay(profile.company_id);
  if (!/^rzp_(test|live)_\w+$/.test(keyId)) return { error: "Key ID looks wrong. It starts with rzp_live_ or rzp_test_." };
  const useSecret = secret || (current?.keyId === keyId ? current.secret : "");
  if (!useSecret) return { error: "Enter the Key Secret." };
  try { await rzpCall({ keyId, secret: useSecret }, "/payment_links?count=1"); }
  catch (e) { return { error: `Razorpay rejected these keys: ${errMsg(e)}` }; }
  const row: Record<string, unknown> = { company_id: profile.company_id, rzp_key_id: keyId, rzp_key_secret_enc: encryptSecret(useSecret), updated_at: new Date().toISOString() };
  if (hook) row.rzp_webhook_secret_enc = encryptSecret(hook);
  const { error } = await createAdminClient().from("lb_quote_settings").upsert(row, { onConflict: "company_id" });
  if (error) return { error: errMsg(error) };
  revalidatePath("/settings/quotes");
  return { ok: `Razorpay connected (${keyId.startsWith("rzp_test_") ? "test mode" : "live"}).` };
}
