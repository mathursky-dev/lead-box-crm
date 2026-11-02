import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { PRODUCT_COLS, imageUrl, type StoreProduct } from "@/lib/store";
import { ProductsView } from "./products";

export const metadata = { title: "Store products" };

export default async function StoreProducts() {
  const { profile } = await requireAdmin();
  const { data, error } = await (await createClient()).from("lb_products").select(PRODUCT_COLS)
    .eq("company_id", profile.company_id).order("sort_order").order("name");
  if (error) return <ErrorBox message={/price|in_store|schema cache/i.test(error.message) ? "The store is not set up yet: the database update for the WhatsApp store has to be run once (Supabase SQL)." : error.message} />;
  const rows = (data ?? []) as unknown as StoreProduct[];
  return <ProductsView rows={rows.map((p) => ({ ...p, image: imageUrl(p.image_path) }))} />;
}
