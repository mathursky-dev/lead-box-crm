"use server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/util";

// Public (unauthenticated) customer-care endpoints: booking page, feedback form, referral form.
// Everything goes through service-role RPCs that validate the input again.

// Best-effort burst guard per server instance.
const hits = new Map<string, number[]>();
async function tooMany(bucket: string, max = 6) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `${bucket}:${ip}`, now = Date.now(), win = hits.get(key)?.filter((t) => now - t < 60_000) ?? [];
  win.push(now);
  hits.set(key, win);
  if (hits.size > 5000) hits.clear();
  return win.length > max;
}
const SAFE = /required|closed|taken|already|Pick|Valid phone|own referral link|not found|from 0 to 10|upcoming appointments/i;
const clean = (m: string | undefined, fallback: string) => (m && SAFE.test(m) ? m : fallback);

async function phoneFor(companyId: string, raw: string) {
  const { data: co } = await createAdminClient().from("lb_companies").select("default_country").eq("id", companyId).maybeSingle();
  return normalizePhone(String(raw ?? ""), co?.default_country ?? "IN");
}

export async function bookSlot(code: string, input: { name: string; phone: string; note: string; at: string; website?: string }): Promise<{ error?: string; label?: string }> {
  if (input.website) return { label: "" }; // honeypot
  if (await tooMany("book")) return { error: "Too many tries. Please wait a minute and try again." };
  if (!/^[A-Z0-9]{4,12}$/i.test(code)) return { error: "Booking page not found." };
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "Please enter your name." };
  if (Number.isNaN(Date.parse(String(input.at ?? "")))) return { error: "Pick a time slot." };
  const db = createAdminClient();
  const { data: s } = await db.from("lb_care_settings").select("company_id").eq("booking_code", code.toUpperCase()).maybeSingle();
  if (!s) return { error: "Booking page not found." };
  const phone = await phoneFor(s.company_id, input.phone);
  if (!phone) return { error: "Please enter a valid WhatsApp number." };
  const { data, error } = await db.rpc("lb_book_slot", {
    p_code: code.toUpperCase(), p: { phone_e164: phone, name, note: String(input.note ?? "").trim().slice(0, 1000), starts_at: input.at },
  });
  if (error) return { error: clean(error.message, "Could not book. Please try again.") };
  return { label: String((data as { label?: string })?.label ?? "") };
}

export async function submitFeedback(token: string, score: number, comment: string): Promise<{ error?: string; reviewUrl?: string | null }> {
  if (await tooMany("fb", 10)) return { error: "Too many tries. Please wait a minute and try again." };
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "Link not found." };
  if (!Number.isInteger(score) || score < 0 || score > 10) return { error: "Pick a score from 0 to 10." };
  const { data, error } = await createAdminClient().rpc("lb_submit_feedback", { p_token: token, p_score: score, p_comment: String(comment ?? "").slice(0, 2000) });
  if (error) return { error: clean(error.message, "Could not save. Please try again.") };
  return { reviewUrl: (data as { review_url?: string | null })?.review_url ?? null };
}

export async function submitReferral(code: string, input: { name: string; phone: string; note: string; website?: string }): Promise<{ error?: string; ok?: boolean }> {
  if (input.website) return { ok: true }; // honeypot
  if (await tooMany("ref")) return { error: "Too many tries. Please wait a minute and try again." };
  if (!/^[A-Z0-9]{6,12}$/i.test(code)) return { error: "Referral link not found." };
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "Please enter your name." };
  const db = createAdminClient();
  const { data: c } = await db.from("lb_customers").select("company_id").eq("referral_code", code.toUpperCase()).maybeSingle();
  if (!c) return { error: "Referral link not found." };
  const phone = await phoneFor(c.company_id, input.phone);
  if (!phone) return { error: "Please enter a valid mobile number." };
  const { error } = await db.rpc("lb_submit_referral", { p_code: code.toUpperCase(), p: { phone_e164: phone, name, note: String(input.note ?? "").trim().slice(0, 1000) } });
  if (error) return { error: clean(error.message, "Could not save. Please try again.") };
  return { ok: true };
}
