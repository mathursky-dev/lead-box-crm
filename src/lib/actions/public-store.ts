"use server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/util";

export type OrderResult = { error?: string; orderNo?: number; total?: number } | undefined;

// Best-effort burst guard per server instance (public, unauthenticated endpoint).
const hits = new Map<string, number[]>();
function tooMany(ip: string) {
  const now = Date.now(), win = hits.get(ip)?.filter((t) => now - t < 60_000) ?? [];
  win.push(now);
  hits.set(ip, win);
  if (hits.size > 5000) hits.clear();
  return win.length > 6;
}

/** Mini-store checkout (/s/<code>) → lb_place_order (service role). Prices are always taken from the database. */
export async function placeOrder(code: string, input: { name: string; phone: string; address: string; note: string; website?: string; items: { id: string; qty: number }[] }): Promise<OrderResult> {
  if (input.website) return { orderNo: 0 }; // honeypot
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (tooMany(ip)) return { error: "Too many tries. Please wait a minute and try again." };
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return { error: "Store not found." };
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 50)
    .filter((i) => typeof i?.id === "string" && /^[0-9a-f-]{36}$/.test(i.id) && Number.isInteger(i.qty) && i.qty > 0)
    .map((i) => ({ product_id: i.id, qty: Math.min(i.qty, 999) }));
  if (!items.length) return { error: "Your cart is empty." };
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "Please enter your name." };

  const db = createAdminClient();
  const { data: st } = await db.from("lb_stores").select("company_id,is_active").eq("code", code).maybeSingle();
  if (!st?.is_active) return { error: "This store is not taking orders right now." };
  const { data: co } = await db.from("lb_companies").select("default_country").eq("id", st.company_id).maybeSingle();
  const phone = normalizePhone(String(input.phone ?? ""), co?.default_country ?? "IN");
  if (!phone) return { error: "Please enter a valid WhatsApp number." };

  const { data, error } = await db.rpc("lb_place_order", {
    p_code: code,
    p: { phone_e164: phone, name, address: String(input.address ?? "").trim().slice(0, 500), note: String(input.note ?? "").trim().slice(0, 1000), items },
  });
  if (error) {
    const m = error.message ?? "";
    return { error: /Minimum order|no longer available|address is required|cart is empty|Too many items|not taking orders|Valid phone|Name is required/i.test(m) ? m : "Could not place the order. Please try again." };
  }
  return { orderNo: Number(data?.order_no), total: Number(data?.total) };
}
