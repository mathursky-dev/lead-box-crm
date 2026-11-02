"use server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { normQuote, quoteFingerprint } from "@/lib/quotes-server";

// Public (no login) accept & sign of a quotation: /q/<token>/sign.

const hits = new Map<string, number[]>();
async function tooMany(ip: string, max = 8) {
  const now = Date.now(), win = hits.get(ip)?.filter((t) => now - t < 60_000) ?? [];
  win.push(now);
  hits.set(ip, win);
  if (hits.size > 5000) hits.clear();
  return win.length > max;
}
const SAFE = /already signed|expired|turned off|can't be signed|not found/i;

export async function signQuote(token: string, input: { name: string; signature: string; agree: boolean; website?: string }): Promise<{ error?: string; docNo?: string }> {
  if (input.website) return { error: "Please try again." }; // honeypot
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  if (await tooMany(ip || "unknown")) return { error: "Too many tries. Please wait a minute." };
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "Quotation not found." };
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 2) return { error: "Please type your full name." };
  if (!input.agree) return { error: "Please tick the box to accept the quotation." };
  const png = String(input.signature ?? "");
  if (!png.startsWith("data:image/png;base64,") || png.length < 800) return { error: "Please draw your signature in the box." };
  if (png.length > 400_000) return { error: "Signature image is too large. Clear it and sign again." };

  const db = createAdminClient();
  const { data: row } = await db.from("lb_quotes").select("*").eq("public_token", token).eq("kind", "quotation").maybeSingle();
  if (!row) return { error: "Quotation not found." };
  const hash = quoteFingerprint(normQuote(row));
  const { data, error } = await db.rpc("lb_quote_sign", {
    p_token: token, p_name: name, p_png: png, p_hash: hash, p_ip: ip.slice(0, 100), p_ua: (h.get("user-agent") ?? "").slice(0, 400),
  });
  if (error) return { error: SAFE.test(error.message) ? error.message : "Could not save your signature. Please try again." };
  return { docNo: String(data ?? row.doc_no) };
}
