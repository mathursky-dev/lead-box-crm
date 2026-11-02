import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { KIND_LABEL, QUOTE_STATUS, inr, type QuoteKind, type QuoteStatus } from "@/lib/quotes";
import { orderStatus, paymentStatus } from "@/lib/store";
import { apptStatus, careUrl, nowMs } from "@/lib/care";
import { appOrigin, careSettings } from "@/lib/care-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account", robots: { index: false } };

const fmt = (v: string, withTime = false) => new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", ...(withTime ? { weekday: "short", hour: "numeric", minute: "2-digit" } : {}),
}).format(new Date(v));

// Customer portal: /p/<64-char token>. The customer sees their quotations, invoices, payment links, orders and appointments.
async function load(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const db = createAdminClient();
  const { data: c } = await db.from("lb_customers").select("id,company_id,name,phone_e164,referral_code").eq("portal_token", token).maybeSingle();
  if (!c) return null;
  const s = await careSettings(db, c.company_id);
  if (!s?.portal_enabled) return null;
  const { data: ok } = await db.rpc("lb_company_entitled", { p_company: c.company_id });
  if (ok === false) return null;
  const { data: leads } = await db.from("lb_leads").select("id").eq("company_id", c.company_id).eq("customer_id", c.id).is("deleted_at", null);
  const leadIds = (leads ?? []).map((l) => l.id as string);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: co }, { data: qs }, { data: quotes }, { data: links }, { data: orders }, { data: appts }, { data: fb }, { count: referred }] = await Promise.all([
    db.from("lb_companies").select("name").eq("id", c.company_id).maybeSingle(),
    db.from("lb_quote_settings").select("business_name,phone,email,address").eq("company_id", c.company_id).maybeSingle(),
    db.from("lb_quotes").select("id,kind,doc_no,status,issue_date,valid_until,total,amount_paid,public_token")
      .eq("company_id", c.company_id).in("lead_id", leadIds.length ? leadIds : none).not("status", "in", "(draft,cancelled)").order("issue_date", { ascending: false }).limit(50),
    db.from("lb_payment_links").select("id,amount,description,short_url,status,created_at")
      .eq("company_id", c.company_id).in("lead_id", leadIds.length ? leadIds : none).eq("status", "created").not("short_url", "is", null).order("created_at", { ascending: false }).limit(10),
    db.from("lb_orders").select("id,order_no,total,status,payment_status,created_at,items").eq("company_id", c.company_id).eq("customer_id", c.id).order("created_at", { ascending: false }).limit(30),
    db.from("lb_appointments").select("id,appt_no,starts_at,status,note").eq("company_id", c.company_id).eq("customer_id", c.id).order("starts_at", { ascending: false }).limit(20),
    db.from("lb_feedback").select("token,status").eq("company_id", c.company_id).eq("customer_id", c.id).in("status", ["pending", "sent", "not_sent"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("lb_referrals").select("id", { count: "exact", head: true }).eq("company_id", c.company_id).eq("referrer_customer_id", c.id),
  ]);
  const origin = await appOrigin();
  return {
    c, s, origin, company: (qs?.business_name as string) || (co?.name as string) || "", contact: qs,
    quotes: quotes ?? [], links: links ?? [], orders: orders ?? [], appts: appts ?? [], referred: referred ?? 0,
    feedbackUrl: fb ? careUrl(origin, "feedback", fb.token as string) : null,
    bookingUrl: s.booking_enabled && s.booking_code ? careUrl(origin, "booking", s.booking_code) : null,
    referralUrl: s.referral_enabled && c.referral_code ? careUrl(origin, "referral", c.referral_code as string) : null,
  };
}

function Section({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">{title}{count ? <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">{count}</span> : null}</h2>
      {children}
    </section>
  );
}
const Badge = ({ cls, children }: { cls: string; children: React.ReactNode }) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{children}</span>;

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const r = await load((await params).token);
  if (!r) notFound();
  const { c, s, company, contact, quotes, links, orders, appts, feedbackUrl, bookingUrl, referralUrl, referred } = r;
  const now = nowMs();
  const upcoming = appts.filter((a) => new Date(a.starts_at as string).getTime() > now && ["booked", "confirmed"].includes(a.status as string));
  const due = quotes.filter((q) => q.kind === "invoice" && !["paid"].includes(q.status as string) && Number(q.total) > Number(q.amount_paid));
  const empty = !quotes.length && !orders.length && !appts.length && !links.length;
  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-emerald-700 px-4 pb-14 pt-8 text-white">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm opacity-80">{company}</p>
          <h1 className="mt-1 text-2xl font-bold">Hi {c.name?.split(" ")[0] || "there"} 👋</h1>
          <p className="mt-1 text-sm opacity-90">Your quotations, invoices, orders and appointments in one place.</p>
        </div>
      </header>
      <div className="mx-auto -mt-10 max-w-2xl space-y-4 px-4">
        {(links.length > 0 || due.length > 0) && (
          <Section title="Payments due">
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.id as string} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2">
                  <div className="min-w-0 text-sm"><div className="font-semibold text-slate-900">{inr(Number(l.amount))}</div><div className="truncate text-xs text-slate-600">{l.description as string}</div></div>
                  <a href={l.short_url as string} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Pay now</a>
                </li>
              ))}
              {!links.length && due.map((q) => (
                <li key={q.id as string} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm">
                  <span>Invoice {q.doc_no as string}</span><b>{inr(Number(q.total) - Number(q.amount_paid))} due</b>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {(upcoming.length > 0 || bookingUrl) && (
          <Section title="Appointments">
            {upcoming.length > 0 ? (
              <ul className="space-y-2">
                {upcoming.map((a) => { const st = apptStatus(a.status as string); return (
                  <li key={a.id as string} className="flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm">
                    <span>📅 <b>{fmt(a.starts_at as string, true)}</b>{a.note ? <span className="block text-xs text-slate-600">{a.note as string}</span> : null}</span>
                    <Badge cls={st.cls}>{st.label}</Badge>
                  </li>
                ); })}
              </ul>
            ) : <p className="text-sm text-slate-600">No upcoming appointment.</p>}
            {bookingUrl && <a href={bookingUrl} className="mt-3 inline-block rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700">Book {upcoming.length ? "another" : "an"} appointment</a>}
          </Section>
        )}
        {quotes.length > 0 && (
          <Section title="Quotations & invoices" count={quotes.length}>
            <ul className="divide-y divide-slate-100">
              {quotes.map((q) => { const st = QUOTE_STATUS[q.status as QuoteStatus] ?? QUOTE_STATUS.sent; return (
                <li key={q.id as string} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{KIND_LABEL[q.kind as QuoteKind]} {q.doc_no as string}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500"><Badge cls={st.cls}>{st.label}</Badge>{fmt(q.issue_date as string)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">{inr(Number(q.total))}</div>
                    <a href={`/q/${q.public_token}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-emerald-700 underline">View PDF</a>
                  </div>
                </li>
              ); })}
            </ul>
          </Section>
        )}
        {orders.length > 0 && (
          <Section title="Orders" count={orders.length}>
            <ul className="divide-y divide-slate-100">
              {orders.map((o) => { const st = orderStatus(o.status as string), p = paymentStatus(o.payment_status as string); return (
                <li key={o.id as string} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">Order #{o.order_no as number}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500"><Badge cls={st.cls}>{st.label}</Badge><Badge cls={p.cls}>{p.label}</Badge>{fmt(o.created_at as string)} · {(o.items as unknown[]).length} item(s)</div>
                  </div>
                  <b className="shrink-0">{inr(Number(o.total))}</b>
                </li>
              ); })}
            </ul>
          </Section>
        )}
        {empty && <Section title="Nothing here yet"><p className="text-sm text-slate-600">Your quotations, invoices and orders will appear here.</p></Section>}
        {feedbackUrl && (
          <Section title="How did we do?">
            <p className="text-sm text-slate-600">Tell us about your experience, it takes 10 seconds.</p>
            <a href={feedbackUrl} className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Rate us ⭐</a>
          </Section>
        )}
        {referralUrl && (
          <Section title="Refer a friend">
            <p className="text-sm text-slate-600">{s.referral_reward || "Know someone who needs us? Share your personal link."}</p>
            <p className="mt-2 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{referralUrl}</p>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Check out ${company}: ${referralUrl}`)}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white">Share on WhatsApp</a>
            {referred > 0 && <p className="mt-2 text-xs text-slate-500">You have referred {referred} friend{referred === 1 ? "" : "s"}. Thank you! 🙏</p>}
          </Section>
        )}
        {(s.portal_note || contact?.phone || contact?.email) && (
          <p className="px-1 text-center text-xs text-slate-500">
            {s.portal_note && <span className="block">{s.portal_note}</span>}
            {[contact?.phone, contact?.email].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </main>
  );
}
