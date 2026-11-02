import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { PRODUCT_COLS, imageUrl, type StoreProduct } from "@/lib/store";
import { ProductsView } from "./products";

export const metadata = { title: "Store products" };

export default async function StoreProducts({ searchParams }: { searchParams: Promise<{ stock?: string }> }) {
  const { stock: filter } = await searchParams;
  const { profile } = await requireAdmin();
  const sb = await createClient();
  const { data, error } = await sb.from("lb_products").select(PRODUCT_COLS)
    .eq("company_id", profile.company_id).order("sort_order").order("name");
  if (error) return <ErrorBox message={/price|in_store|schema cache/i.test(error.message) ? "The store is not set up yet: the database update for the WhatsApp store has to be run once (Supabase SQL)." : error.message} />;
  const rows = (data ?? []) as unknown as StoreProduct[];
  // Stock columns come from the stock-alerts SQL; without it the page works as before (no quantity tracking).
  const st = await sb.from("lb_products").select("id,stock_qty,low_stock_at").eq("company_id", profile.company_id);
  const stock = new Map((st.error ? [] : st.data ?? []).map((r) => [r.id as string, { qty: r.stock_qty as number | null, low: r.low_stock_at as number }]));
  return (
    <ProductsView stockOn={!st.error} initialOnly={filter === "low" && !st.error ? "low" : ""}
      rows={rows.map((p) => ({ ...p, image: imageUrl(p.image_path), stock_qty: stock.get(p.id)?.qty ?? null, low_stock_at: stock.get(p.id)?.low ?? 5 }))} />
  );
}
