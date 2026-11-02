// Shared (client + server) bits of the WhatsApp mini-store.

export const ORDER_STATUSES = [
  { value: "new", label: "New", cls: "bg-amber-100 text-amber-800" },
  { value: "confirmed", label: "Confirmed", cls: "bg-blue-100 text-blue-800" },
  { value: "packed", label: "Packed", cls: "bg-violet-100 text-violet-800" },
  { value: "shipped", label: "Shipped", cls: "bg-indigo-100 text-indigo-800" },
  { value: "delivered", label: "Delivered", cls: "bg-green-100 text-green-800" },
  { value: "cancelled", label: "Cancelled", cls: "bg-slate-200 text-slate-600" },
] as const;
export const PAYMENT_STATUSES = [
  { value: "unpaid", label: "Unpaid", cls: "bg-red-50 text-red-700" },
  { value: "paid", label: "Paid", cls: "bg-green-100 text-green-800" },
  { value: "refunded", label: "Refunded", cls: "bg-slate-200 text-slate-600" },
] as const;
export const CHANNEL_LABEL: Record<string, string> = { store: "Mini-store", whatsapp: "WhatsApp catalog", manual: "Added by staff" };

export const orderStatus = (v: string) => ORDER_STATUSES.find((s) => s.value === v) ?? ORDER_STATUSES[0];
export const paymentStatus = (v: string) => PAYMENT_STATUSES.find((s) => s.value === v) ?? PAYMENT_STATUSES[0];

export type OrderItem = { product_id: string | null; name: string; sku?: string | null; price: number; qty: number; amount: number };
export type Order = {
  id: string; order_no: number; channel: string; name: string | null; phone_e164: string; address: string | null; note: string | null;
  items: OrderItem[]; subtotal: number; delivery_fee: number; total: number; status: string; payment_status: string;
  staff_note: string | null; lead_id: string | null; created_at: string; updated_at: string;
};
export const ORDER_COLS = "id,order_no,channel,name,phone_e164,address,note,items,subtotal,delivery_fee,total,status,payment_status,staff_note,lead_id,created_at,updated_at";

export type StoreProduct = {
  id: string; name: string; is_active: boolean; price: number | null; mrp: number | null; description: string; image_path: string | null;
  sku: string | null; category: string; unit: string; in_store: boolean; in_stock: boolean; sort_order: number;
};
export const PRODUCT_COLS = "id,name,is_active,price,mrp,description,image_path,sku,category,unit,in_store,in_stock,sort_order";

export const STORE_BUCKET = "lb-store";
/** Public URL of a product photo in the public "lb-store" bucket. */
export const imageUrl = (path?: string | null) =>
  path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${STORE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}` : null;

/** ₹1,234 or ₹1,234.50 (Indian grouping). */
export const rupees = (v?: number | string | null) => {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
};

export const storeUrl = (origin: string, code: string) => `${origin.replace(/\/$/, "")}/s/${code}`;
export const STORE_KEYWORDS = ["catalog", "catalogue", "menu", "price list", "store", "shop", "products"];
