import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { paymentStatus, rupees, type OrderItem } from "@/lib/store";
import { upiLink } from "@/lib/upi";
import { UpiOrderPay } from "./upi-pay";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay for your order", robots: { index: false } };

// Public order payment page: /o/<64-hex token>, sent in the WhatsApp chat from the inbox 🛍️ button.
export default async function OrderPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = createAdminClient();
  const { data: o } = await db.from("lb_orders").select("id,company_id,order_no,name,items,subtotal,delivery_fee,total,status,payment_status,pay_method,upi_utr")
    .eq("pay_token", token).maybeSingle();
  if (!o) notFound();
  const [{ data: st }, { data: links }] = await Promise.all([
    db.from("lb_stores").select("name,color,upi_id,upi_name").eq("company_id", o.company_id).maybeSingle(),
    db.from("lb_payment_links").select("short_url,status").eq("order_id", o.id).eq("status", "created").order("created_at", { ascending: false }).limit(1),
  ]);
  const items = (o.items ?? []) as OrderItem[];
  const total = Number(o.total);
  const paid = o.payment_status === "paid";
  const closed = o.status === "cancelled" || o.payment_status === "refunded";
  const color = st?.color ?? "#16a34a";
  const shop = st?.name ?? "Order";
  const upi = st?.upi_id ? { id: st.upi_id, name: st.upi_name || shop } : null;
  const link = upi ? upiLink(upi, total, `Order ${o.order_no} ${shop}`.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 50)) : null;
  const rzp = links?.[0]?.short_url as string | undefined;
  const ps = paymentStatus(o.payment_status);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow">
        <div className="px-5 py-4 text-white" style={{ background: color }}>
          <div className="text-sm opacity-90">{shop}</div>
          <h1 className="text-lg font-semibold">Order #{o.order_no}</h1>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <ul className="divide-y">
            {items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3 py-1.5"><span className="min-w-0">{i.qty} × {i.name}</span><span className="shrink-0">{rupees(i.amount)}</span></li>
            ))}
            {Number(o.delivery_fee) > 0 && <li className="flex justify-between py-1.5 text-slate-600"><span>Delivery</span><span>{rupees(o.delivery_fee)}</span></li>}
            <li className="flex justify-between py-2 text-base font-semibold text-slate-900"><span>Total</span><span>{rupees(total)}</span></li>
          </ul>
          <div className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ps.cls}`}>{ps.label}</div>
          {paid ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-3 text-center text-emerald-800">✓ Payment received. Thank you!</div>
          ) : closed ? (
            <div className="rounded-lg bg-slate-100 px-3 py-3 text-center text-slate-600">This order is closed.</div>
          ) : (
            <>
              {rzp && <a href={rzp} className="block w-full rounded-lg px-4 py-3 text-center font-semibold text-white" style={{ background: color }}>Pay {rupees(total)} online</a>}
              {upi && link && <UpiOrderPay token={token} link={link} upiId={upi.id} upiName={upi.name} amount={rupees(total)} color={color} utr={o.upi_utr} />}
              {!rzp && !upi && <p className="text-slate-600">Please pay as discussed on WhatsApp. We will confirm your order shortly.</p>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
