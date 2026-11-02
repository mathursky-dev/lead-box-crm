import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { Kpi } from "@/components/kit";
import { fmtDay, istDate } from "@/lib/dates";
import { rupees } from "@/lib/store";
import { PO_COLS, PO_STATUSES, poDue, poLabel, poStatus, type PurchaseOrder } from "@/lib/purchases";

export const metadata = { title: "Purchase orders" };
export const dynamic = "force-dynamic";

const day = (d?: string | null) => (d ? fmtDay(d + "T12:00:00Z") : "—");
const num = (po: PurchaseOrder) => ({ ...po, total: Number(po.total), received_value: Number(po.received_value), amount_paid: Number(po.amount_paid) });

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ status?: string; vendor?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireAdmin();
  const sb = await createClient();
  const status = PO_STATUSES.some((s) => s.value === sp.status) || sp.status === "open" || sp.status === "due" ? sp.status! : "";
  const [pR, vR] = await Promise.all([
    sb.from("lb_purchase_orders").select(PO_COLS).eq("company_id", profile.company_id).order("po_no", { ascending: false }).limit(1000),
    sb.from("lb_vendors").select("id,name").eq("company_id", profile.company_id).order("name"),
  ]);
  if (pR.error) return <ErrorBox message={/lb_purchase_orders|schema cache/.test(pR.error.message) ? "Purchase orders are not set up yet: run the purchase-orders SQL once in Supabase." : pR.error.message} />;
  const vendors = (vR.data ?? []) as { id: string; name: string }[];
  const vName = new Map(vendors.map((v) => [v.id, v.name]));
  const all = ((pR.data ?? []) as PurchaseOrder[]).map(num);
  const open = all.filter((p) => p.status === "ordered" || p.status === "partial");
  const toReceive = open.reduce((s, p) => s + Math.max(0, p.total - p.received_value), 0);
  const toPay = all.reduce((s, p) => s + poDue(p), 0);
  const today = istDate();
  const monthStart = today.slice(0, 8) + "01";
  const thisMonth = all.filter((p) => p.order_date >= monthStart && p.status !== "cancelled").reduce((s, p) => s + p.total, 0);
  const rows = all.filter((p) => (!sp.vendor || p.vendor_id === sp.vendor)
    && (!status || (status === "open" ? p.status === "ordered" || p.status === "partial" : status === "due" ? poDue(p) > 0 && p.status !== "draft" : p.status === status)));

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open orders" value={open.length} sub="Ordered, goods not fully received" icon="cart" tone="blue" href="/store/purchases?status=open" />
        <Kpi label="Goods to receive" value={rupees(toReceive)} sub="Value still to arrive" icon="clock" tone="amber" />
        <Kpi label="To pay vendors" value={rupees(toPay)} sub="Received / ordered minus paid" icon="rupee" tone="red" href="/store/purchases?status=due" />
        <Kpi label="Ordered this month" value={rupees(thisMonth)} sub="Purchase orders dated this month" icon="chart" tone="green" />
      </div>
      <section className="card overflow-hidden">
        <form action="/store/purchases" className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <select className="input max-w-44" name="status" defaultValue={status} aria-label="Status">
            <option value="">All statuses ({all.length})</option><option value="open">Open (ordered / part received)</option><option value="due">Payment due</option>
            {PO_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input max-w-52" name="vendor" defaultValue={sp.vendor ?? ""} aria-label="Vendor">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button className="btn-ghost btn-sm">Apply</button>
          <div className="ml-auto flex gap-2">
            <Link href="/store/vendors" className="btn-ghost">Vendors</Link>
            <Link href="/store/purchases/new" className="btn-primary">+ New purchase order</Link>
          </div>
        </form>
        {!vendors.length && <p className="border-b border-slate-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">First add a vendor (supplier) in <Link href="/store/vendors" className="font-semibold underline">Vendors</Link>, then create a purchase order.</p>}
        {!rows.length ? <p className="p-10 text-center text-sm text-slate-500">{all.length ? "No purchase orders match." : "No purchase orders yet."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50"><tr>
                <th className="th">PO</th><th className="th">Vendor</th><th className="th">Date</th><th className="th">Expected</th><th className="th">Status</th>
                <th className="th text-right">Total</th><th className="th text-right">Received</th><th className="th text-right">Paid</th><th className="th text-right">To pay</th>
              </tr></thead>
              <tbody className="divide-y">
                {rows.map((p) => { const st = poStatus(p.status); const due = poDue(p); const late = p.expected_date && (p.status === "ordered" || p.status === "partial") && p.expected_date < today; return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="td"><Link href={`/store/purchases/${p.id}`} className="font-semibold text-brand-700 hover:underline">{poLabel(p.po_no)}</Link></td>
                    <td className="td">{vName.get(p.vendor_id) ?? "—"}</td>
                    <td className="td">{day(p.order_date)}</td>
                    <td className={`td ${late ? "font-semibold text-red-600" : ""}`}>{day(p.expected_date)}{late ? " (late)" : ""}</td>
                    <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span></td>
                    <td className="td text-right">{rupees(p.total)}</td>
                    <td className="td text-right">{rupees(p.received_value)}</td>
                    <td className="td text-right">{rupees(p.amount_paid)}</td>
                    <td className={`td text-right ${due > 0 && p.status !== "draft" ? "font-semibold text-amber-700" : "text-slate-400"}`}>{rupees(due)}</td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
