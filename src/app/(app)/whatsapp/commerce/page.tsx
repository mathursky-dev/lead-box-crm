import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { money } from "@/lib/dates";
import { OrgList } from "../../admin/org-list";
import { Kpi, Panel, EmptyState } from "../ui";

export const metadata = { title: "Commerce · WhatsApp" };

export default async function Commerce() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const [refs, { data: leads }, { count: orders }] = await Promise.all([
    loadRefs(),
    sb.from("lb_leads").select("product_id,status_category,won_value,expected_value,payment_status,payment_due_amount").not("product_id", "is", null).limit(20000),
    sb.from("lb_messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("type", "order"),
  ]);
  const rows = refs.products.map((p) => {
    const l = (leads ?? []).filter((x) => x.product_id === p.id);
    const won = l.filter((x) => x.status_category === "won");
    return { ...p, leads: l.length, open: l.filter((x) => !["won", "lost", "invalid"].includes(x.status_category)).length, won: won.length,
      revenue: won.reduce((s, x) => s + Number(x.won_value ?? 0), 0), pipeline: l.filter((x) => !["won", "lost", "invalid"].includes(x.status_category)).reduce((s, x) => s + Number(x.expected_value ?? 0), 0),
      due: l.filter((x) => x.payment_status && x.payment_status !== "paid").reduce((s, x) => s + Number(x.payment_due_amount ?? 0), 0) };
  });
  const sum = (k: "revenue" | "pipeline" | "due" | "won") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Products & services" value={refs.products.filter((p) => p.is_active !== false).length} sub={`${refs.products.length} total`} icon="cart" tone="amber" />
        <Kpi label="Won revenue" value={money(sum("revenue"))} sub={`${sum("won")} deals`} icon="check" tone="green" />
        <Kpi label="Open pipeline" value={money(sum("pipeline"))} sub="expected value of open leads" icon="chart" tone="blue" />
        <Kpi label="Payments due" value={money(sum("due"))} sub={`${orders ?? 0} WhatsApp cart orders received`} icon="wallet" tone="red" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Panel title="Products" icon="cart">
          {!rows.length ? <EmptyState icon="cart" title="No products yet">Add the products or services you sell — leads, revenue and payments are then tracked per product.</EmptyState> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Product</th><th className="th">Leads</th><th className="th">Open</th><th className="th">Won</th><th className="th">Revenue</th><th className="th">Pipeline</th><th className="th">Due</th></tr></thead>
              <tbody className="divide-y">{rows.map((r) => (
                <tr key={r.id} className={r.is_active === false ? "text-slate-400" : ""}>
                  <td className="td font-medium"><Link href={`/leads?product_id=${r.id}`} className="hover:text-brand-700">{r.name}</Link></td>
                  <td className="td">{r.leads}</td><td className="td">{r.open}</td><td className="td">{r.won}</td>
                  <td className="td">{money(r.revenue)}</td><td className="td">{money(r.pipeline)}</td><td className="td">{r.due ? money(r.due) : "—"}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Panel>
        <div className="space-y-4">
          {isAdmin(profile) && <OrgList table="lb_products" title="Products / Services" items={refs.products} />}
          <Panel title="Meta catalog" icon="link">
            <p className="text-sm text-slate-600">Selling straight inside WhatsApp (catalog, cart, product messages) needs a Commerce Manager catalog linked to your WhatsApp Business Account in Meta. Once linked, cart orders customers send arrive in Live chat as <b>order</b> messages and are counted above.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
