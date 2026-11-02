"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, can } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { enqueue, kick } from "@/lib/inbox-send";
import { errMsg } from "@/lib/util";
import { imageUrl, rupees, storeUrl, type OrderItem } from "@/lib/store";
import { companyRazorpay } from "@/lib/quotes-server";
import { appOrigin } from "@/lib/care-server";
import { createPaymentLink } from "@/lib/actions/quotes";

// Inbox: send Store products into a WhatsApp chat (photo cards or the Meta catalog) and
// create an order from the chat with a payment request (UPI page, Razorpay link or WhatsApp Pay).

export type ChatProduct = { id: string; name: string; price: number | null; mrp: number | null; description: string; image: string | null; sku: string | null; category: string; unit: string; in_stock: boolean; in_store: boolean };
export type ChatStore = {
  ready: boolean; code: string | null; active: boolean; delivery_fee: number; free_above: number | null;
  upi: boolean; razorpay: boolean; catalog: boolean; waPay: boolean; payReady: boolean;
};
export type PayMethod = "upi" | "razorpay" | "whatsapp_pay" | "none";
type Result = { error?: string; ok?: string; warn?: string; order_no?: number; url?: string };

const Uuid = z.uuid();
const SQL_MISSING = /pay_token|upi_id|wa_catalog_id|lb_enqueue_rich|lb_chat_order|schema cache/i;
const sqlHint = "Chat payments need the new database update (Supabase SQL 20261102140000) once.";

async function storeRow(companyId: string) {
  const db = createAdminClient();
  const full = await db.from("lb_stores").select("code,is_active,delivery_fee,free_delivery_above,upi_id,upi_name,wa_catalog_id,wa_pay_config,name").eq("company_id", companyId).maybeSingle();
  if (!full.error) return { row: full.data, payReady: true };
  const basic = await db.from("lb_stores").select("code,is_active,delivery_fee,free_delivery_above,name").eq("company_id", companyId).maybeSingle();
  return { row: basic.data ? { ...basic.data, upi_id: null, upi_name: null, wa_catalog_id: null, wa_pay_config: null } : null, payReady: false };
}

/** Products and payment options for the chat "🛍️ Products" picker. */
export async function chatCatalog(convId: string): Promise<{ error?: string; products?: ChatProduct[]; store?: ChatStore }> {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(convId).success) return { error: "Invalid chat" };
  if (!hasServiceRole()) return { error: "The server is not configured (service role key)." };
  const sb = await createClient();
  const { data: conv } = await sb.from("lb_conversations").select("id").eq("id", convId).maybeSingle();
  if (!conv) return { error: "Chat not found" };
  const { data, error } = await sb.from("lb_products").select("id,name,price,mrp,description,image_path,sku,category,unit,in_stock,in_store,is_active,sort_order")
    .eq("company_id", profile.company_id).eq("is_active", true).order("sort_order").order("name").limit(500);
  if (error) return { error: /price|image_path|in_store/.test(error.message) ? "Set up the Store first (Store → Products)." : errMsg(error) };
  const { row, payReady } = await storeRow(profile.company_id);
  const rzp = Boolean(await companyRazorpay(profile.company_id).catch(() => null));
  return {
    products: (data ?? []).map((p) => ({
      id: p.id, name: p.name, price: p.price == null ? null : Number(p.price), mrp: p.mrp == null ? null : Number(p.mrp), description: p.description ?? "",
      image: imageUrl(p.image_path), sku: p.sku, category: p.category ?? "", unit: p.unit ?? "", in_stock: p.in_stock !== false, in_store: Boolean(p.in_store),
    })),
    store: {
      ready: Boolean(row), code: row?.code ?? null, active: Boolean(row?.is_active), delivery_fee: Number(row?.delivery_fee ?? 0),
      free_above: row?.free_delivery_above == null ? null : Number(row.free_delivery_above),
      upi: Boolean(row?.upi_id), razorpay: rzp, catalog: Boolean(row?.wa_catalog_id), waPay: Boolean(row?.wa_pay_config), payReady,
    },
  };
}

async function rich(convId: string, type: "image" | "interactive", body: string, payload: Record<string, unknown>) {
  const { error } = await (await createClient()).rpc("lb_enqueue_rich", { p_conv: convId, p_client_id: randomUUID(), p_type: type, p_body: body, p_payload: payload });
  if (error) return { error: SQL_MISSING.test(error.message) ? sqlHint : errMsg(error) };
  return {};
}

const caption = (p: ChatProduct) => [
  `*${p.name}*`,
  p.price != null ? `${rupees(p.price)}${p.unit ? ` / ${p.unit}` : ""}${p.mrp != null && p.mrp > p.price ? `  (MRP ${rupees(p.mrp)})` : ""}` : "",
  p.description ? p.description.slice(0, 300) : "",
  p.in_stock ? "" : "Currently out of stock",
].filter(Boolean).join("\n");

/**
 * Sends products into the chat. mode "cards": one photo + name + price per product (works for everyone).
 * mode "catalog": WhatsApp catalog message from the Meta catalog linked in Store settings (customer adds to cart in WhatsApp).
 */
export async function sendChatProducts(convId: string, ids: string[], mode: "cards" | "catalog", note: string, withLink: boolean): Promise<Result> {
  const { profile } = await requireProfile();
  if (!can(profile, "chats.send")) return { error: "You don't have permission to send WhatsApp messages." };
  if (!Uuid.safeParse(convId).success) return { error: "Invalid chat" };
  const want = [...new Set(ids.filter((x) => Uuid.safeParse(x).success))];
  if (!want.length) return { error: "Pick at least one product." };
  if (mode === "cards" && want.length > 10) return { error: "Send up to 10 products as photos at a time (or share the store link)." };
  if (mode === "catalog" && want.length > 30) return { error: "WhatsApp allows up to 30 products in one catalog message." };
  const res = await chatCatalog(convId);
  if (res.error) return { error: res.error };
  const products = want.map((id) => res.products!.find((p) => p.id === id)).filter(Boolean) as ChatProduct[];
  if (products.length !== want.length) return { error: "Some products were not found." };
  const intro = note.trim().slice(0, 900);
  const origin = await appOrigin();
  const link = withLink && res.store?.code && res.store.active ? storeUrl(origin, res.store.code) : null;

  if (mode === "catalog") {
    const { row } = await storeRow(profile.company_id);
    if (!row?.wa_catalog_id) return { error: "Add your Meta catalog ID in Store → Settings first." };
    const noSku = products.filter((p) => !p.sku);
    if (noSku.length) return { error: `Add an SKU (same as Content ID in Meta Commerce Manager) for: ${noSku.map((p) => p.name).join(", ")}` };
    const body = intro || (products.length === 1 ? "Have a look 👇" : "Here are our products 👇 Tap to view and add to cart.");
    const payload = products.length === 1
      ? { type: "product", body: { text: body }, action: { catalog_id: row.wa_catalog_id, product_retailer_id: products[0].sku } }
      : { type: "product_list", header: { type: "text", text: (row.name || "Our products").slice(0, 60) }, body: { text: body },
          action: { catalog_id: row.wa_catalog_id, sections: [{ title: "Products", product_items: products.map((p) => ({ product_retailer_id: p.sku })) }] } };
    const r = await rich(convId, "interactive", `🛍️ ${products.map((p) => p.name).join(", ")}`.slice(0, 300), payload);
    if (r.error) return r;
  } else {
    if (intro) {
      const r = await enqueue(convId, randomUUID(), { type: "text", body: intro });
      if (r.error && !r.ok) return { error: r.error };
    }
    for (const p of products) {
      const text = caption(p);
      if (p.image) {
        const r = await rich(convId, "image", text, { link: p.image, caption: text.slice(0, 1024) });
        if (r.error) return r;
      } else {
        const r = await enqueue(convId, randomUUID(), { type: "text", body: text });
        if (r.error && !r.ok) return { error: r.error };
      }
    }
  }
  if (link) {
    const r = await enqueue(convId, randomUUID(), { type: "text", body: `🛒 To order, open our store: ${link}` });
    if (r.error && !r.ok) return { error: r.error, warn: "Products sent, the store link was not." };
  }
  kick();
  return { ok: `${products.length} product${products.length > 1 ? "s" : ""} sent.` };
}

const Order = z.object({
  items: z.array(z.object({ product_id: z.uuid(), qty: z.number().int().min(1).max(999) })).min(1).max(50),
  delivery: z.number().min(0).max(100000),
  note: z.string().max(1000).default(""),
  address: z.string().max(500).default(""),
  pay: z.enum(["upi", "razorpay", "whatsapp_pay", "none"]),
});

const paise = (v: number) => ({ value: Math.round(v * 100), offset: 100 });

/** Creates an order from the chat and sends the bill with the chosen way to pay. */
export async function createChatOrder(convId: string, input: z.input<typeof Order>): Promise<Result> {
  const { profile } = await requireProfile();
  if (!can(profile, "chats.send")) return { error: "You don't have permission to send WhatsApp messages." };
  if (!Uuid.safeParse(convId).success) return { error: "Invalid chat" };
  if (!hasServiceRole()) return { error: "The server is not configured (service role key)." };
  const p = Order.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid order" };
  const v = p.data;
  const sb = await createClient();
  const { data: conv } = await sb.from("lb_conversations").select("id,last_inbound_at").eq("id", convId).maybeSingle();
  if (!conv) return { error: "Chat not found" };
  if (!conv.last_inbound_at || Date.now() - new Date(conv.last_inbound_at).getTime() > 24 * 3600 * 1000)
    return { error: "WhatsApp 24-hour window is closed. Ask the customer to message you first (or send a template)." };
  const { row: st, payReady } = await storeRow(profile.company_id);
  if (!payReady) return { error: sqlHint };
  if (v.pay === "upi" && !st?.upi_id) return { error: "Add your UPI ID in Store → Settings first." };
  if (v.pay === "whatsapp_pay" && !st?.wa_pay_config) return { error: "Add your WhatsApp Pay configuration name in Store → Settings first." };
  if (v.pay === "razorpay" && !(await companyRazorpay(profile.company_id).catch(() => null))) return { error: "Add your Razorpay keys first: Settings → Quotes & Payments." };

  const { data: o, error } = await sb.rpc("lb_chat_order", { p_conv: convId, p_items: v.items, p_delivery: v.delivery, p_note: v.note.trim(), p_address: v.address.trim() });
  if (error || !o) return { error: error ? (SQL_MISSING.test(error.message) ? sqlHint : errMsg(error)) : "Order was not created" };
  const order = o as { id: string; order_no: number; lead_id: string; items: OrderItem[]; subtotal: number; delivery_fee: number; total: number; pay_token: string };
  const db = createAdminClient();
  if (v.pay !== "none") await db.from("lb_orders").update({ pay_method: v.pay }).eq("id", order.id);
  const total = Number(order.total);
  const lines = order.items.map((i) => `${i.qty} × ${i.name} = ${rupees(i.amount)}`);
  const bill = [`🧾 *Order #${order.order_no}*`, ...lines, Number(order.delivery_fee) > 0 ? `Delivery: ${rupees(order.delivery_fee)}` : "", `*Total: ${rupees(total)}*`].filter(Boolean).join("\n");
  const page = `${(await appOrigin()).replace(/\/$/, "")}/o/${order.pay_token}`;
  revalidatePath("/store");

  if (v.pay === "razorpay") {
    const r = await createPaymentLink({ lead_id: order.lead_id, order_id: order.id, amount: total, description: `Order #${order.order_no} (${order.items.length} item${order.items.length > 1 ? "s" : ""})`, send: false });
    if (r.error || !r.url) return { error: `Order #${order.order_no} created, but the Razorpay link failed: ${r.error ?? "no link"}`, order_no: order.order_no };
    const s = await enqueue(convId, randomUUID(), { type: "text", body: `${bill}\n\n💳 Pay securely here: ${r.url}` });
    if (s.error && !s.ok) return { error: s.error, order_no: order.order_no, url: r.url };
    return { ok: `Order #${order.order_no} created and payment link sent.`, order_no: order.order_no, url: r.url };
  }
  if (v.pay === "whatsapp_pay") {
    const payload = {
      type: "order_details",
      body: { text: `Order #${order.order_no} · ${rupees(total)}. Tap Review and Pay to pay with any UPI app.` },
      action: {
        name: "review_and_pay",
        parameters: {
          reference_id: order.pay_token.slice(0, 32), type: "physical-goods", payment_type: "upi", payment_configuration: st!.wa_pay_config, currency: "INR",
          total_amount: paise(total),
          order: {
            status: "pending",
            items: order.items.map((i) => ({ retailer_id: (i.sku || i.product_id || i.name).slice(0, 60), name: i.name.slice(0, 60), amount: paise(Number(i.price)), quantity: i.qty })),
            subtotal: paise(Number(order.subtotal)),
            ...(Number(order.delivery_fee) > 0 ? { shipping: paise(Number(order.delivery_fee)) } : {}),
          },
        },
      },
    };
    const r = await rich(convId, "interactive", `${bill}\n(WhatsApp Pay)`, payload);
    if (r.error) return { error: `Order #${order.order_no} created, but the WhatsApp Pay message failed: ${r.error}`, order_no: order.order_no, url: page };
    kick();
    return { ok: `Order #${order.order_no} created. Customer can pay inside WhatsApp.`, order_no: order.order_no, url: page };
  }
  const tail = v.pay === "upi"
    ? `\n\n📲 Pay by UPI (GPay / PhonePe / Paytm): ${page}\nUPI ID: ${st!.upi_id}${st!.upi_name ? ` (${st!.upi_name})` : ""}\nAfter paying, send us the screenshot or UTR.`
    : `\n\nWe will confirm your order shortly. 🙏`;
  const s = await enqueue(convId, randomUUID(), { type: "text", body: bill + tail });
  if (s.error && !s.ok) return { error: s.error, order_no: order.order_no, url: page };
  return { ok: `Order #${order.order_no} created and sent.`, order_no: order.order_no, url: page };
}
