import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { imageUrl } from "@/lib/store";
import { StoreFront, type ShopItem } from "./store-front";

export const dynamic = "force-dynamic";

async function load(code: string) {
  if (!/^[A-Z0-9]{4,12}$/i.test(code)) return null;
  const db = createAdminClient();
  const { data: st } = await db.from("lb_stores")
    .select("company_id,code,name,tagline,color,wa_phone,min_order,delivery_fee,free_delivery_above,ask_address,checkout_note,thank_you,is_active")
    .eq("code", code.toUpperCase()).maybeSingle();
  if (!st) return null;
  const [{ data: products }, { data: num }, { data: ok }] = await Promise.all([
    db.from("lb_products").select("id,name,price,mrp,description,image_path,category,unit,in_stock,sort_order")
      .eq("company_id", st.company_id).eq("is_active", true).eq("in_store", true).not("price", "is", null)
      .order("sort_order").order("name").limit(500),
    // No WhatsApp number set on the store: use the company's first connected number.
    st.wa_phone ? Promise.resolve({ data: null }) : db.from("lb_wa_numbers").select("display_phone").eq("company_id", st.company_id).eq("is_active", true).not("display_phone", "is", null).limit(1).maybeSingle(),
    db.rpc("lb_company_entitled", { p_company: st.company_id }),
  ]);
  const wa = st.wa_phone || String(num?.display_phone ?? "").replace(/\D/g, "") || null;
  const items: ShopItem[] = (products ?? []).map((p) => ({
    id: p.id, name: p.name, price: Number(p.price), mrp: p.mrp == null ? null : Number(p.mrp), description: p.description ?? "",
    image: imageUrl(p.image_path), category: p.category ?? "", unit: p.unit ?? "", inStock: p.in_stock !== false,
  }));
  return { st, items, wa, open: st.is_active && ok !== false };
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const r = await load((await params).code);
  return {
    title: r?.st.name ?? "Store", description: r?.st.tagline || undefined, robots: { index: false },
    openGraph: r ? { title: r.st.name, description: r.st.tagline || `Order from ${r.st.name} on WhatsApp`, images: r.items.find((i) => i.image)?.image ? [r.items.find((i) => i.image)!.image!] : undefined } : undefined,
  };
}

export default async function StorePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await load(code);
  if (!r) notFound();
  const { st, items, wa, open } = r;
  return (
    <StoreFront
      code={st.code} items={items} open={open} wa={wa}
      store={{
        name: st.name, tagline: st.tagline, color: st.color, minOrder: Number(st.min_order), deliveryFee: Number(st.delivery_fee),
        freeAbove: st.free_delivery_above == null ? null : Number(st.free_delivery_above), askAddress: st.ask_address,
        checkoutNote: st.checkout_note, thankYou: st.thank_you,
      }}
    />
  );
}
