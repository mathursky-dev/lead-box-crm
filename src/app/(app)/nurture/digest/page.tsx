import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Manager digest" };

export default async function DigestPage() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const [{ data: counts }, { data: digests }, { data: co }] = await Promise.all([
    sb.rpc("lb_nurture_counts"),
    sb.from("lb_notifications").select("id,title,body,created_at").eq("user_id", profile.id).eq("type", "digest").order("created_at", { ascending: false }).limit(30),
    sb.from("lb_companies").select("digest_hour").eq("id", profile.company_id).maybeSingle(),
  ]);
  const now: [string, string, string][] = [["unanswered", "Customers waiting", "/nurture?q=unanswered"], ["overdue", "Overdue follow-ups", "/nurture?q=overdue"],
    ["unassigned", "Unassigned", "/nurture?q=unassigned"], ["complaints", "Open complaints", "/nurture?q=complaints"], ["signals", "Buying signals (48h)", "/nurture?q=signals"],
    ["failed_jobs", "Failed automation", "/nurture?q=failed_jobs"]];
  return (
    <>
      <PageHeader icon="mail" tone="blue" title="Manager digest" sub={`Admins and team leaders get a daily digest notification at ${co?.digest_hour ?? 9}:00 IST (change in Admin → Settings). It covers the previous day for the whole company.`} />
      <h2 className="mb-2 text-sm font-semibold text-navy-900">Right now</h2>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {now.map(([k, l, href]) => (
          <Link key={k} href={href} className="card block p-3 hover:border-brand-500"><div className="text-2xl font-semibold text-navy-900">{counts?.[k] ?? 0}</div><div className="text-xs text-slate-600">{l}</div></Link>
        ))}
      </section>
      <h2 className="mb-2 mt-6 text-sm font-semibold text-navy-900">Past digests</h2>
      {!digests?.length ? <Empty title="No digests yet">The first one arrives at the next digest hour.</Empty> : (
        <ul className="card divide-y text-sm">{digests.map((d) => (
          <li key={d.id} className="p-3"><div className="font-medium text-navy-900">{d.title}</div><div className="text-slate-600">{d.body}</div><div className="text-xs text-slate-400">{fmtDateTime(d.created_at)}</div></li>
        ))}</ul>
      )}
    </>
  );
}
