import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { Kpi } from "@/components/kit";
import { KIND_LABEL, QUOTE_STATUS, inr, type QuoteKind, type QuoteStatus } from "@/lib/quotes";
import { fmtDay } from "@/lib/dates";

export const metadata = { title: "Quotes & Invoices" };

type SP = { kind?: string; status?: string; q?: string; page?: string };
const PER = 50;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const kind = sp.kind === "quotation" || sp.kind === "invoice" ? sp.kind : "";
  const status = sp.status && sp.status in QUOTE_STATUS ? sp.status : "";
  const term = String(sp.q ?? "").replace(/[%_,()\\*]/g, " ").trim().slice(0, 60);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  let qy = sb.from("lb_quotes").select("id,kind,doc_no,status,issue_date,valid_until,total,amount_paid,lead_id,lead:lb_leads(lead_no,customer:lb_customers(name,phone_e164))", { count: "exact" })
    .eq("company_id", profile.company_id).order("created_at", { ascending: false }).range((page - 1) * PER, page * PER - 1);
  if (kind) qy = qy.eq("kind", kind);
  if (status) qy = qy.eq("status", status);
  if (term) qy = qy.ilike("doc_no", `%${term}%`);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [{ data, count, error }, { data: month }, { data: links }] = await Promise.all([
    qy,
    sb.from("lb_quotes").select("kind,total,amount_paid,status").eq("company_id", profile.company_id).gte("issue_date", monthStart).neq("status", "cancelled"),
    sb.from("lb_payment_links").select("amount_paid,status,paid_at").eq("company_id", profile.company_id).gte("paid_at", monthStart),
  ]);
  const sum = (k: QuoteKind) => (month ?? []).filter((m) => m.kind === k).reduce((s, m) => s + Number(m.total), 0);
  const paid = (links ?? []).reduce((s, l) => s + Number(l.amount_paid), 0);
  const href = (p: Partial<SP>) => `/quotes?${new URLSearchParams(Object.entries({ kind, status, q: term, ...p }).filter(([, v]) => v) as [string, string][])}`;
  const total = count ?? 0;

  return (
    <div>
      <PageHeader title="Quotes & Invoices" icon="files" sub="Quotations, invoices and payment links of your leads. Create one from a lead's page." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Quoted this month" value={inr(sum("quotation"))} icon="files" tone="green" />
        <Kpi label="Invoiced this month" value={inr(sum("invoice"))} icon="rupee" tone="blue" />
        <Kpi label="Collected online this month" value={inr(paid)} icon="wallet" tone="violet" />
      </div>
      <section className="card overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3" action="/quotes">
          <select name="kind" defaultValue={kind} className="input w-auto" aria-label="Type"><option value="">All types</option><option value="quotation">Quotations</option><option value="invoice">Invoices</option></select>
          <select name="status" defaultValue={status} className="input w-auto" aria-label="Status"><option value="">Any status</option>
            {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <input name="q" defaultValue={term} className="input w-44" placeholder="Number e.g. QT-0012" aria-label="Search number" />
          <button className="btn-primary btn-sm">Filter</button>
          <span className="ml-auto text-sm text-slate-500">{total} document{total === 1 ? "" : "s"}</span>
        </form>
        {error ? <p className="p-4 text-sm text-red-600">Quotes are not set up yet (database update pending).</p> : !data?.length ? (
          <Empty title="No quotations yet" icon="files">Open a lead and click <b>+ Quotation</b> to make one.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-4 py-2">Number</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Date</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Paid</th><th className="px-4 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((r) => {
                  const l = r.lead as unknown as { lead_no: number; customer: { name: string | null; phone_e164: string } } | null;
                  const st = QUOTE_STATUS[r.status as QuoteStatus];
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2"><Link className="font-semibold text-brand-700 hover:underline" href={`/quotes/${r.id}`}>{r.doc_no}</Link></td>
                      <td className="px-4 py-2">{KIND_LABEL[r.kind as QuoteKind]}</td>
                      <td className="px-4 py-2">{l ? <Link className="hover:underline" href={`/leads/${r.lead_id}`}>{l.customer?.name || l.customer?.phone_e164} <span className="text-xs text-slate-400">LB-{l.lead_no}</span></Link> : "—"}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDay(r.issue_date)}</td>
                      <td className="px-4 py-2 text-right font-medium">{inr(Number(r.total))}</td>
                      <td className="px-4 py-2 text-right">{Number(r.amount_paid) > 0 ? inr(Number(r.amount_paid)) : "—"}</td>
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PER && (
          <div className="flex justify-end gap-2 border-t px-4 py-2 text-sm">
            {page > 1 && <Link className="btn-ghost btn-sm" href={href({ page: String(page - 1) })}>Prev</Link>}
            {page * PER < total && <Link className="btn-ghost btn-sm" href={href({ page: String(page + 1) })}>Next</Link>}
          </div>
        )}
      </section>
    </div>
  );
}
