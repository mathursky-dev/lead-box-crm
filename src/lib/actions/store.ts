"use server";
import { randomBytes, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile, type Profile } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { STORE_BUCKET, STORE_KEYWORDS, storeUrl } from "@/lib/store";

// WhatsApp mini-store admin actions. Writes use the service role pinned to the admin's active company
// (profile.company_id follows the Super Admin company switcher). Order updates go through lb_set_order (RLS + permission checks).

type FormState = { error?: string; ok?: string } | undefined;
type Db = ReturnType<typeof createAdminClient>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const on = z.string().optional().transform((v) => v === "on");
const amount = z.union([z.literal(""), z.coerce.number().min(0).max(99999999)]).optional().transform((v) => (v === "" || v === undefined ? null : v));

async function audit(db: Db, me: Profile, action: string, entity: string, entityId: string | null, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action, entity, entity_id: entityId, data });
}
const done = (msg: string): FormState => { revalidatePath("/store", "layout"); revalidatePath("/admin", "layout"); return { ok: msg }; };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : process.env.APP_URL ?? "http://localhost:3000";
}
export async function newStoreCode() { return randomBytes(6).toString("base64").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6).padEnd(6, "X"); }

// ------------------------------------------------------------- store settings
export async function saveStore(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    name: z.string().trim().min(1, "Store name is required").max(80),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/, "Link code: 4–12 letters/digits"),
    tagline: z.string().trim().max(160).default(""),
    color: z.string().trim().regex(HEX, "Pick a colour"),
    wa_phone: z.string().trim().transform((v) => v.replace(/\D/g, "")).refine((v) => !v || /^[1-9][0-9]{6,14}$/.test(v), "WhatsApp number: digits with country code, e.g. 919876543210"),
    min_order: amount, delivery_fee: amount, free_delivery_above: amount,
    checkout_note: z.string().trim().max(500).default(""),
    thank_you: z.string().trim().max(300).default(""),
    source_id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
    ask_address: on, is_active: on, auto_reply: on,
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const { auto_reply, ...v } = p.data;
  const db = createAdminClient();
  if (v.source_id && !(await db.from("lb_sources").select("id").eq("id", v.source_id).eq("company_id", me.company_id).maybeSingle()).data)
    return { error: "Invalid source" };
  const row = {
    ...v, wa_phone: v.wa_phone || null, min_order: v.min_order ?? 0, delivery_fee: v.delivery_fee ?? 0,
    thank_you: v.thank_you || "Thank you! Your order is placed. We will confirm it on WhatsApp shortly.", updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("lb_stores").upsert({ ...row, company_id: me.company_id }, { onConflict: "company_id" });
  if (error) return { error: error.code === "23505" ? "That link code is taken, generate another." : /lb_stores|schema cache/.test(error.message) ? "Store is not set up yet: run the Store SQL once in Supabase." : errMsg(error) };

  // Handy extras: "/store" quick reply in the inbox, and an optional keyword auto-reply with the link.
  const link = storeUrl(await origin(), v.code);
  const text = `🛍️ Browse our catalog and order here: ${link}`;
  await db.from("lb_quick_replies").upsert({ company_id: me.company_id, shortcut: "store", title: "Store link", body: text, created_by: me.id }, { onConflict: "company_id,shortcut" });
  const BOT = "Store link (auto)";
  const { data: bot } = await db.from("lb_wa_bots").select("id").eq("company_id", me.company_id).eq("name", BOT).maybeSingle();
  if (auto_reply) {
    const b = { keywords: STORE_KEYWORDS, match_type: "contains", reply: text, is_active: true, updated_at: new Date().toISOString() };
    if (bot) await db.from("lb_wa_bots").update(b).eq("id", bot.id);
    else await db.from("lb_wa_bots").insert({ ...b, company_id: me.company_id, name: BOT, priority: 50, created_by: me.id });
  } else if (bot) await db.from("lb_wa_bots").update({ is_active: false }).eq("id", bot.id);

  await audit(db, me, "store.save", "store", null, { code: v.code, is_active: v.is_active });
  return done("Store saved.");
}

// ------------------------------------------------------------------ products
/** Signed upload URL for a product photo ({company}/{uuid}.ext in the public lb-store bucket). */
export async function startProductImage(name: string, size: number, type: string): Promise<{ error?: string; path?: string; token?: string }> {
  const { profile } = await requireAdmin();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return { error: "Use a JPG, PNG, WEBP or GIF image." };
  if (!(size > 0) || size > 5 * 1024 * 1024) return { error: "Photo must be under 5 MB." };
  if (!hasServiceRole()) return { error: "Uploads need the server to be configured (service role key)." };
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type]!;
  const { data, error } = await createAdminClient().storage.from(STORE_BUCKET).createSignedUploadUrl(`${profile.company_id}/${randomUUID()}.${ext}`);
  if (error || !data) return { error: `Upload failed: ${error?.message ?? "no upload URL"}` };
  return { path: data.path, token: data.token };
}

export async function saveProduct(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
    name: z.string().trim().min(1, "Name is required").max(100),
    price: amount, mrp: amount,
    description: z.string().trim().max(2000).default(""),
    sku: z.string().trim().max(100).transform((v) => v || null),
    category: z.string().trim().max(60).default(""),
    unit: z.string().trim().max(30).default(""),
    sort_order: z.coerce.number().int().min(0).max(100000).default(100),
    image_path: z.string().trim().max(300).default(""),
    remove_image: on, in_store: on, in_stock: on,
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const { id, image_path, remove_image, ...v } = p.data;
  if (v.in_store && v.price == null) return { error: "Add a price to show this product in the store." };
  if (v.mrp != null && v.price != null && v.mrp < v.price) return { error: "MRP should be more than the selling price (or leave it empty)." };
  const db = createAdminClient();
  const row: Record<string, unknown> = { ...v };
  let old: string | null = null;
  if (id) {
    const { data } = await db.from("lb_products").select("image_path").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    if (!data) return { error: "Product not found" };
    old = data.image_path as string | null;
  }
  if (image_path) {
    if (!image_path.startsWith(`${me.company_id}/`) || image_path.includes("..") || image_path.split("/").length !== 2) return { error: "Invalid photo" };
    row.image_path = image_path;
  } else if (remove_image) row.image_path = null;

  const { data, error } = id
    ? await db.from("lb_products").update(row).eq("id", id).eq("company_id", me.company_id).select("id").single()
    : await db.from("lb_products").insert({ ...row, company_id: me.company_id }).select("id").single();
  if (error) return { error: error.code === "23505" ? (/sku/.test(error.message) ? "Another product already has that SKU." : "A product with that name already exists.") : errMsg(error) };
  if (old && "image_path" in row && row.image_path !== old) await db.storage.from(STORE_BUCKET).remove([old]);
  // Stock (stock-alerts SQL): saved through lb_set_product_stock so the change is logged and alerts fire.
  if (form.get("stock_on") === "1") {
    const raw = String(form.get("stock_qty") ?? "").trim();
    const qty = raw === "" ? null : Math.floor(Number(raw));
    const lowRaw = Math.floor(Number(form.get("low_stock_at") ?? 5));
    if (qty != null && (!Number.isFinite(qty) || qty < 0 || qty > 10_000_000)) return { error: "Stock quantity must be 0 or more." };
    const low = Number.isFinite(lowRaw) ? Math.min(Math.max(lowRaw, 0), 1_000_000) : 5;
    const { data: cur } = await db.from("lb_products").select("stock_qty,low_stock_at").eq("id", data.id).single();
    if (!cur || cur.stock_qty !== qty || cur.low_stock_at !== low) {
      const r = await db.rpc("lb_set_product_stock", { p_product: data.id, p_company: me.company_id, p_qty: qty, p_low: low, p_actor: me.id, p_note: null });
      if (r.error) return { error: `Product saved, but stock was not: ${r.error.message}` };
    }
  }
  await audit(db, me, id ? "product.update" : "product.create", "lb_products", data.id, { name: v.name, price: v.price, in_store: v.in_store });
  return done("Product saved.");
}

/** Quick toggles from the product list. */
export async function setProductFlag(id: string, flag: "in_store" | "in_stock" | "is_active", value: boolean): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!z.uuid().safeParse(id).success || !["in_store", "in_stock", "is_active"].includes(flag)) return { error: "Invalid" };
  const db = createAdminClient();
  if (flag === "in_store" && value) {
    const { data } = await db.from("lb_products").select("price").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    if (data?.price == null) return { error: "Add a price first." };
  }
  const { error } = await db.from("lb_products").update({ [flag]: value }).eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  return done("Saved.");
}

// -------------------------------------------------------------------- orders
export async function updateOrder(id: string, status: string, payment: string, note: string): Promise<FormState> {
  await requireProfile();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid order" };
  const sb = await createClient();
  const { error } = await sb.rpc("lb_set_order", { p_order: id, p_status: status, p_payment: payment, p_note: note.slice(0, 1000) });
  if (error) return { error: errMsg(error) };
  revalidatePath("/store");
  return { ok: "Order updated." };
}
