"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, type Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import type { PoLine } from "@/lib/purchases";

// Vendors + purchase orders. Admin-only; writes use the service role pinned to the admin's active company
// (profile.company_id follows the Super Admin company switcher). PO save / receive go through
// lb_save_po / lb_receive_po (purchase-orders SQL) so totals, stock and the receipt log stay in one transaction.

type FormState = { error?: string; ok?: string } | undefined;
type Db = ReturnType<typeof createAdminClient>;

const NOT_SET_UP = "Purchase orders are not set up yet: run the purchase-orders SQL once in Supabase.";
const dbErr = (e: { message: string; code?: string }) =>
  /lb_vendors|lb_purchase_orders|lb_po_|lb_save_po|lb_receive_po|schema cache/.test(e.message) ? NOT_SET_UP : errMsg(e);

async function audit(db: Db, me: Profile, action: string, entity: string, entityId: string | null, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action, entity, entity_id: entityId, data });
}
const refresh = () => { revalidatePath("/store", "layout"); revalidatePath("/profit-loss"); };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const date = z.union([z.literal(""), z.string().regex(YMD, "Invalid date")]).optional().transform((v) => v || null);

// ------------------------------------------------------------------ vendors
export async function saveVendor(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
    name: z.string().trim().min(1, "Vendor name is required").max(120),
    contact_person: z.string().trim().max(100).default(""),
    phone: z.string().trim().max(30).default(""),
    email: z.union([z.literal(""), z.email("Invalid email")]).default(""),
    gstin: z.string().trim().toUpperCase().max(15).refine((v) => !v || /^[0-9A-Z]{15}$/.test(v), "GSTIN is 15 letters/digits").default(""),
    address: z.string().trim().max(500).default(""),
    payment_terms: z.string().trim().max(100).default(""),
    notes: z.string().trim().max(1000).default(""),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const { id, phone, ...v } = p.data;
  const phone_e164 = phone ? normalizePhone(phone) : null;
  if (phone && !phone_e164) return { error: "Invalid phone number" };
  const db = createAdminClient();
  const row = { ...v, phone_e164, updated_at: new Date().toISOString() };
  const r = id
    ? await db.from("lb_vendors").update(row).eq("id", id).eq("company_id", me.company_id).select("id").maybeSingle()
    : await db.from("lb_vendors").insert({ ...row, company_id: me.company_id, created_by: me.id }).select("id").single();
  if (r.error) return { error: r.error.code === "23505" ? "A vendor with this name already exists." : dbErr(r.error) };
  if (!r.data) return { error: "Vendor not found" };
  await audit(db, me, id ? "vendor.update" : "vendor.create", "vendor", r.data.id, { name: v.name });
  refresh();
  return { ok: "Vendor saved." };
}

export async function setVendorActive(id: string, active: boolean): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid" };
  const db = createAdminClient();
  const { error } = await db.from("lb_vendors").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: dbErr(error) };
  await audit(db, me, active ? "vendor.activate" : "vendor.deactivate", "vendor", id);
  refresh();
  return { ok: active ? "Vendor active." : "Vendor hidden." };
}

// ------------------------------------------------------------ purchase orders
const lineSchema = z.object({
  product_id: z.union([z.uuid(), z.literal("")]).default(""),
  name: z.string().trim().max(160).default(""),
  unit: z.string().trim().max(30).default(""),
  qty: z.coerce.number().int("Quantity must be a whole number").min(1, "Quantity must be 1 or more").max(10000000),
  unit_cost: z.coerce.number().min(0, "Cost cannot be negative").max(99999999),
  gst_pct: z.coerce.number().min(0).max(100).default(0),
});

/** Create or update a purchase order. Returns the PO id so the form can open it. */
export async function savePurchaseOrder(input: {
  id?: string | null; vendor_id: string; order_date: string; expected_date: string; other_charges: number; notes: string; lines: PoLine[]; place?: boolean;
}): Promise<{ error?: string; id?: string }> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: z.uuid().nullable().optional(),
    vendor_id: z.uuid("Pick a vendor"),
    order_date: date, expected_date: date,
    other_charges: z.coerce.number().min(0, "Other charges cannot be negative").max(99999999).default(0),
    notes: z.string().trim().max(2000).default(""),
    lines: z.array(lineSchema).min(1, "Add at least one item").max(200),
    place: z.boolean().optional(),
  }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const v = p.data;
  const bad = v.lines.findIndex((l) => !l.product_id && !l.name);
  if (bad >= 0) return { error: `Line ${bad + 1}: pick a product or type the item name` };
  const db = createAdminClient();
  const { data, error } = await db.rpc("lb_save_po", {
    p_company: me.company_id, p_actor: me.id, p_po: v.id ?? null, p_vendor: v.vendor_id, p_order_date: v.order_date, p_expected: v.expected_date,
    p_other: v.other_charges, p_notes: v.notes, p_items: v.lines,
  });
  if (error || !data) return { error: error ? dbErr(error) : "Could not save" };
  const id = data as string;
  if (v.place) await db.from("lb_purchase_orders").update({ status: "ordered", ordered_at: new Date().toISOString() }).eq("id", id).eq("status", "draft");
  await audit(db, me, v.id ? "po.update" : "po.create", "purchase_order", id, { vendor_id: v.vendor_id, lines: v.lines.length });
  refresh();
  return { id };
}

export async function setPurchaseOrderStatus(id: string, to: "ordered" | "cancelled" | "draft"): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid" };
  const db = createAdminClient();
  const { data: po } = await db.from("lb_purchase_orders").select("status").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!po) return { error: "Purchase order not found" };
  const allowed: Record<string, string[]> = { ordered: ["draft"], draft: ["ordered"], cancelled: ["draft", "ordered", "partial"] };
  if (!allowed[to]?.includes(po.status)) return { error: `A ${po.status} purchase order can't be changed to ${to}.` };
  const now = new Date().toISOString();
  const patch = to === "ordered" ? { status: to, ordered_at: now } : to === "cancelled" ? { status: to, cancelled_at: now } : { status: to };
  const { error } = await db.from("lb_purchase_orders").update({ ...patch, updated_at: now }).eq("id", id).eq("status", po.status);
  if (error) return { error: dbErr(error) };
  await audit(db, me, `po.${to}`, "purchase_order", id, { from: po.status });
  refresh();
  return { ok: to === "ordered" ? "Marked as ordered." : to === "cancelled" ? (po.status === "partial" ? "Closed. The rest is not coming." : "Purchase order cancelled.") : "Moved back to draft." };
}

export async function deletePurchaseOrder(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid" };
  const db = createAdminClient();
  const { data, error } = await db.from("lb_purchase_orders").delete().eq("id", id).eq("company_id", me.company_id).eq("status", "draft").select("po_no");
  if (error) return { error: dbErr(error) };
  if (!data?.length) return { error: "Only a draft purchase order can be deleted. Cancel it instead." };
  await audit(db, me, "po.delete", "purchase_order", id, { po_no: data[0].po_no });
  refresh();
  return { ok: "Deleted." };
}

/** Receive goods: quantities per PO line. Adds to store stock and logs a receipt (counts in Profit & Loss). */
export async function receivePurchaseOrder(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const id = String(form.get("po_id") ?? "");
  const day = String(form.get("received_on") ?? "");
  if (!z.uuid().safeParse(id).success) return { error: "Invalid" };
  if (day && !YMD.test(day)) return { error: "Invalid date" };
  const lines: { item_id: string; qty: number }[] = [];
  for (const [k, raw] of form.entries()) {
    if (!k.startsWith("qty_")) continue;
    const item = k.slice(4), qty = Number(String(raw).trim() || 0);
    if (!z.uuid().safeParse(item).success) return { error: "Invalid line" };
    if (!Number.isInteger(qty) || qty < 0) return { error: "Quantities must be whole numbers (0 or more)" };
    if (qty > 0) lines.push({ item_id: item, qty });
  }
  if (!lines.length) return { error: "Enter the quantity received for at least one item" };
  const db = createAdminClient();
  const { data, error } = await db.rpc("lb_receive_po", {
    p_company: me.company_id, p_actor: me.id, p_po: id, p_date: day || null, p_lines: lines, p_note: String(form.get("note") ?? "").slice(0, 500),
  });
  if (error) return { error: dbErr(error) };
  await audit(db, me, "po.receive", "purchase_order", id, { lines: lines.length, amount: data });
  refresh();
  return { ok: "Goods received. Stock updated." };
}

/** Record a payment made to the vendor against this PO (adds to amount paid). */
export async function recordVendorPayment(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({ po_id: z.uuid(), amount: z.coerce.number().refine((n) => n !== 0, "Enter the amount").min(-99999999).max(99999999) })
    .safeParse({ po_id: form.get("po_id"), amount: form.get("amount") });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const db = createAdminClient();
  const { data: po } = await db.from("lb_purchase_orders").select("amount_paid,total").eq("id", p.data.po_id).eq("company_id", me.company_id).maybeSingle();
  if (!po) return { error: "Purchase order not found" };
  const next = Math.round((Number(po.amount_paid) + p.data.amount) * 100) / 100;
  if (next < 0) return { error: "Paid amount cannot go below zero" };
  const { error } = await db.from("lb_purchase_orders").update({ amount_paid: next, updated_at: new Date().toISOString() })
    .eq("id", p.data.po_id).eq("amount_paid", po.amount_paid);
  if (error) return { error: dbErr(error) };
  await audit(db, me, "po.payment", "purchase_order", p.data.po_id, { amount: p.data.amount, note: String(form.get("note") ?? "").slice(0, 200) });
  refresh();
  return { ok: "Payment recorded." };
}
