import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Pager, Empty, ErrorBox } from "@/components/static";
import { fmtDay, money } from "@/lib/dates";
import { Icon } from "@/components/kit";

export const metadata = { title: "Customers" };
const LIMIT = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; offset?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  if (!can(profile, "customers.view")) redirect("/dashboard");
  const offset = Math.max(0, Number(sp.offset) || 0);
  const { data, error } = await (await createClient()).rpc("lb_list_customers", { p: { q: sp.q, limit: LIMIT, offset } });
  const rows = (data?.rows ?? []) as { id: string; name: string | null; wa_profile_name: string | null; phone_e164: string; email: string | null; location: string | null; wa_opted_out_at: string | null; leads: number; last_activity: string | null; won_value: number }[];
  return (
    <>
      <PageHeader icon="user" tone="violet" title="Customer 360" sub="Every customer you can access. Open one to see chats, leads, notes, follow-ups and the full timeline." />
      <form className="card mb-4 flex gap-2 p-3"><input className="input max-w-md" name="q" defaultValue={sp.q} placeholder="Search name, phone or email" /><button className="btn-primary"><Icon name="search" className="h-3.5 w-3.5" />Search</button></form>
      {error ? <ErrorBox message={error.message} /> : !rows.length ? <Empty icon="user" title="No customers found" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Customer</th><th className="th">Phone</th><th className="th">Location</th><th className="th">Opportunities</th><th className="th">Won</th><th className="th">Last activity</th></tr></thead>
            <tbody className="divide-y">{rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/customers/${c.id}`}>{c.name || c.wa_profile_name || "Unnamed"}</Link>
                  {c.email && <div className="text-xs text-slate-500">{c.email}</div>}</td>
                <td className="td">{c.phone_e164}{c.wa_opted_out_at && <span className="badge ml-2 bg-red-50 text-red-700">opted out</span>}</td>
                <td className="td">{c.location ?? "—"}</td><td className="td">{c.leads}</td><td className="td">{money(c.won_value)}</td><td className="td">{fmtDay(c.last_activity)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <Pager total={data?.total ?? 0} limit={LIMIT} offset={offset} params={{ q: sp.q }} basePath="/customers" />
    </>
  );
}
