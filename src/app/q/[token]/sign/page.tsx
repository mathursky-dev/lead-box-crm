import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { normQuote, quoteSettings } from "@/lib/quotes-server";
import { inr } from "@/lib/quotes";
import { istDate } from "@/lib/dates";
import { SignForm } from "./sign-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept quotation", robots: { index: false } };

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

// Public page where a customer reads and e-signs a quotation: /q/<64-char token>/sign.
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = createAdminClient();
  const { data: row } = await db.from("lb_quotes").select("*").eq("public_token", token).eq("kind", "quotation").maybeSingle();
  if (!row || row.status === "cancelled") notFound();
  const q = normQuote(row);
  const [st, { data: lead }] = await Promise.all([
    quoteSettings(q.company_id),
    db.from("lb_leads").select("customer:lb_customers(name)").eq("id", q.lead_id).maybeSingle(),
  ]);
  const customer = (lead?.customer as unknown as { name: string | null } | null)?.name ?? "";
  const expired = Boolean(q.valid_until && q.valid_until < istDate());
  const blocked = q.signed_at ? `Signed by ${q.signed_name} on ${new Date(q.signed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Thank you!`
    : !st.esign_enabled ? "Online signing is not available for this quotation. Please contact us."
    : q.status === "rejected" ? "This quotation was marked rejected. Please contact us for a fresh one."
    : q.status === "paid" ? "This quotation is already paid. Thank you!"
    : expired ? `This quotation expired on ${day(q.valid_until!)}. Please ask us for an updated one.` : null;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
          <div className="bg-emerald-700 px-6 py-5 text-white">
            <p className="text-sm opacity-80">{st.business_name}</p>
            <h1 className="mt-1 text-xl font-bold">Quotation {q.doc_no}</h1>
            <p className="mt-1 text-sm opacity-90">Total {inr(q.total)} · Dated {day(q.issue_date)}{q.valid_until ? ` · Valid till ${day(q.valid_until)}` : ""}</p>
          </div>
          <div className="space-y-3 p-6">
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {q.items.map((it, i) => (
                <div key={i} className="flex justify-between gap-3 px-3 py-2">
                  <div className="min-w-0"><div className="font-medium text-slate-900">{it.name}</div>
                    <div className="text-xs text-slate-500">{it.qty} × {inr(it.rate)}{it.tax_pct ? ` + ${it.tax_pct}% GST` : ""}</div></div>
                  <div className="whitespace-nowrap font-medium">{inr(it.qty * it.rate)}</div>
                </div>
              ))}
              <div className="flex justify-between bg-slate-50 px-3 py-2 font-semibold"><span>Total (incl. GST)</span><span>{inr(q.total)}</span></div>
            </div>
            <a className="inline-block text-sm font-medium text-emerald-700 underline" href={`/q/${token}`} target="_blank" rel="noreferrer">Open full quotation (PDF) with terms</a>
            {blocked
              ? <p className="rounded-lg bg-slate-50 px-4 py-3 text-center text-sm text-slate-700">{blocked}</p>
              : <SignForm token={token} defaultName={customer} total={inr(q.total)} business={st.business_name} />}
          </div>
        </div>
        <p className="text-center text-xs text-slate-500">Your name, signature, time and IP address are saved as a record of acceptance.</p>
      </div>
    </main>
  );
}
