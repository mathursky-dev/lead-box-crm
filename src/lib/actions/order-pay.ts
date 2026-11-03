"use server";
import { headers } from "next/headers";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { UTR_RE } from "@/lib/upi";
import { rateLimit } from "./auth";

/** Public (/o/<token>): the customer tells us the UPI reference after paying. Staff check the bank and mark Paid. */
export async function submitOrderUtr(token: string, raw: string): Promise<{ error?: string; ok?: string }> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "Invalid link" };
  const utr = String(raw ?? "").replace(/\s/g, "");
  if (!UTR_RE.test(utr)) return { error: "Enter the 12-digit UTR / UPI Ref No. from your UPI app." };
  if (!hasServiceRole()) return { error: "Please try again later." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit(`utr:${token}`, 5, 3600)) || !(await rateLimit(`utr-ip:${ip}`, 20, 3600))) return { error: "Too many tries. Please message us on WhatsApp." };
  const { data, error } = await createAdminClient().rpc("lb_order_utr", { p_token: token, p_utr: utr });
  if (error) return { error: "Could not save. Please send the UTR on WhatsApp." };
  return data ? { ok: "Thank you! We will confirm your payment shortly." } : { error: "This order is already paid or closed." };
}
