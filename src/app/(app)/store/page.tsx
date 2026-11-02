import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { Kpi } from "@/components/kit";
import { istDate, istMidnight } from "@/lib/dates";
import { ORDER_COLS, ORDER_STATUSES, rupees, type Order } from "@/lib/store";
import { OrdersView, StoreLink } from "./orders";

export const metadata = { title: "Store orders" };

type SP = Record<string, string | undefined>;
const PER = 25;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const term = String(sp.q ?? "").replace(/[%_,()\\*]/g, " ").trim().slice(0, 60);
  const cid = profile.company_id;

  let list = sb.from("lb_orders").select(ORDER_COLS, { count: "exact" }).eq("company_id", cid);
  if (sp.status === "open") list = list.in("status", ["new", "confirmed", "packed", "shipped"]);
  else if (ORDER_STATUSES.some((s) => s.value === sp.status)) list = list.eq("status", sp.status!);
  if (["store", "whatsapp", "manual"].includes(sp.channel ?? "")) list = list.eq("channel", sp.channel!);
  if (["unpaid", "paid", "refunded"].includes(sp.pay ?? "")) list = list.eq("payment_status", sp.pay!);
  if (term) list = /^\d+$/.test(term) ? list.or(`order_no.eq.${term},phone_e164.ilike.%${term}%`) : list.or(`name.ilike.%${term}%,phone_e164.ilike.%${term}%`);
  list = list.order("created_at", { ascending: false }).range((page - 1) * PER, page * PER - 1);

  const today = istMidnight(istDate()).toISOString();
  const month = istMidnight(istDate().slice(0, 8) + "01").toISOString();
  const [res, store, todayQ, newQ, monthQ, opened] = await Promise.all([
    list,
    sb.from("lb_stores").select("code,name,is_active,orders_count").eq("company_id", cid).maybeSingle(),
    sb.from("lb_orders").select("id", { count: "exact", head: true }).eq("company_id", cid).gte("created_at", today),
    sb.from("lb_orders").select("id", { count: "exact", head: true }).eq("company_id", cid).eq("status", "new"),
    sb.from("lb_orders").select("total,payment_status").eq("company_id", cid).neq("status", "cancelled").gte("created_at", month).limit(5000),
    // A notification link (/store?order=…) opens that order even when it is not on this page.
    sp.order && /^[0-9a-f-]{36}$/.test(sp.order) ? sb.from("lb_orders").select(ORDER_COLS).eq("id", sp.order).eq("company_id", cid).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (res.error) {
    const missing = /lb_orders|schema cache/i.test(res.error.message);
    return <ErrorBox message={missing ? "The store is not set up yet: the database update for the WhatsApp store has to be run once (Supabase SQL)." : res.error.message} />;
  }
  const m = monthQ.data ?? [];
  const sales = m.reduce((s, o) => s + Number(o.total), 0);
  const unpaid = m.filter((o) => o.payment_status === "unpaid").reduce((s, o) => s + Number(o.total), 0);

  return (
    <>
      {store.data ? <StoreLink code={store.data.code} name={store.data.name} active={store.data.is_active} admin={isAdmin(profile)} /> : (
        <div className="mb-4 rounded-xl border border-dashed border-brand-300 bg-brand-50 p-4 text-sm text-brand-800">
          No store yet. {isAdmin(profile) ? <><Link href="/store/settings" className="font-semibold underline">Create your store</Link>, add prices and photos under <Link href="/store/products" className="font-semibold underline">Products</Link>, then share the link on WhatsApp.</> : "Ask your admin to set it up."}
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Orders today" value={todayQ.count ?? 0} icon="cart" tone="green" />
        <Kpi label="New, not confirmed" value={newQ.count ?? 0} icon="bolt" tone="amber" href="/store?status=new" />
        <Kpi label="Sales this month" value={rupees(sales)} sub={`${m.length} orders, cancelled excluded`} icon="rupee" tone="blue" />
        <Kpi label="Unpaid this month" value={rupees(unpaid)} icon="wallet" tone="red" href="/store?pay=unpaid" />
      </div>
      <OrdersView rows={(res.data ?? []) as unknown as Order[]} total={res.count ?? 0} page={page} per={PER}
        sp={Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "order")) as Record<string, string>}
        open={(opened.data as unknown as Order | null) ?? null} />
    </>
  );
}
