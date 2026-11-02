import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireProfile, isAdmin, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { companyRazorpay, normQuote } from "@/lib/quotes-server";
import { KIND_LABEL, QUOTE_STATUS, inr, type PayLink } from "@/lib/quotes";
import { fmtDateTime } from "@/lib/dates";
import { QuoteActions, PayLinkRow } from "../actions-ui";

export const metadata = { title: "Quotation" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: row } = await sb.from("lb_quotes").select("*").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!row) notFound();
  const q = normQuote(row);
  const [{ data: lead }, { data: links }, { data: inv }, { data: from }, keys] = await Promise.all([
    sb.from("lb_leads").select("id,lead_no,customer:lb_customers(name,phone_e164)").eq("id", q.lead_id).maybeSingle(),
    sb.from("lb_payment_links").select("*").eq("quote_id", id).eq("company_id", profile.company_id).order("created_at", { ascending: false }),
    sb.from("lb_quotes").select("id").eq("from_quote_id", id).eq("company_id", profile.company_id).neq("status", "cancelled").limit(1).maybeSingle(),
    q.from_quote_id ? sb.from("lb_quotes").select("id,doc_no").eq("id", q.from_quote_id).maybeSingle() : Promise.resolve({ data: null }),
    companyRazorpay(profile.company_id),
  ]);
  const h = await headers();
  const base = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const c = (lead?.customer ?? {}) as unknown as { name: string | null; phone_e164: string };
  const st = QUOTE_STATUS[q.status];
  const canSend = can(profile, "chats.send");
  return (
    <div className="space-y-4">
      {saved && <div className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">Saved. Now send it on WhatsApp or download the PDF.</div>}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">{KIND_LABEL[q.kind]}</div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-navy-900">{q.doc_no}</h1>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${st.cls}`}>{st.label}</span>
            </div>
            <div className="text-sm text-slate-600">
              {lead && <><Link className="text-brand-700 hover:underline" href={`/leads/${lead.id}`}>LB-{lead.lead_no}</Link> · {c.name || "Customer"} · {c.phone_e164}</>}
              {from && <> · from <Link className="text-brand-700 hover:underline" href={`/quotes/${from.id}`}>{from.doc_no}</Link></>}
            </div>
            <div className="mt-1 text-xs text-slate-500">Created {fmtDateTime(q.created_at)}{q.sent_at && <> · Sent {fmtDateTime(q.sent_at)}</>}{q.paid_at && <> · Paid {fmtDateTime(q.paid_at)}</>}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold text-navy-900">{inr(q.total)}</div>
            {q.amount_paid > 0 && <div className="text-sm text-emerald-700">Paid {inr(q.amount_paid)}{q.total > q.amount_paid && <> · Due {inr(q.total - q.amount_paid)}</>}</div>}
          </div>
        </div>
        <QuoteActions q={q} leadId={q.lead_id} canSend={canSend} admin={isAdmin(profile)} payReady={Boolean(keys)} shareUrl={`${base}/q/${q.public_token}`} hasInvoice={inv?.id ?? null} />
        {!keys && <p className="text-xs text-slate-500">Payment links need your Razorpay keys{isAdmin(profile) ? <> — add them in <Link className="text-brand-700 underline" href="/settings/quotes">Settings → Quotes &amp; Payments</Link></> : ", ask your admin"}.</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <iframe title={`${q.doc_no} PDF`} src={`/api/quotes/${q.id}/pdf`} className="h-[75vh] w-full bg-slate-100" />
        </div>
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Payment links</h2>
          {!links?.length ? <p className="text-xs text-slate-500">No payment links for this document yet.</p>
            : <ul className="divide-y divide-slate-100">{(links as PayLink[]).map((l) => <PayLinkRow key={l.id} l={{ ...l, amount: Number(l.amount) }} canSend={canSend} />)}</ul>}
        </section>
      </div>
    </div>
  );
}
