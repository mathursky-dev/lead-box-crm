import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { SuppressionForm, RemoveSuppression } from "./forms";

export const metadata = { title: "Consent & suppression" };

export default async function ConsentPage() {
  const { profile } = await requireProfile();
  if (!can(profile, "consent.manage")) redirect("/nurture");
  const sb = await createClient();
  const [{ data: supp }, { data: events }] = await Promise.all([
    sb.from("lb_suppressions").select("phone_e164,reason,created_at,by:lb_profiles(full_name)").order("created_at", { ascending: false }).limit(200),
    sb.from("lb_consent_events").select("id,status,source,note,created_at,customer:lb_customers(id,name,phone_e164),actor:lb_profiles(full_name)").order("created_at", { ascending: false }).limit(100),
  ]);
  return (
    <>
      <PageHeader title="Consent & suppression"
        sub="Automated journeys and campaigns only message customers with a recorded WhatsApp opt-in. STOP/UNSUBSCRIBE replies opt customers out automatically and START opts them back in. Suppressed numbers are never messaged by automation." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Suppression list</h2>
          <SuppressionForm />
          {!supp?.length ? <p className="mt-3 text-sm text-slate-500">No suppressed numbers.</p> : (
            <ul className="mt-3 divide-y text-sm">{supp.map((x) => (
              <li key={x.phone_e164} className="flex items-center justify-between gap-2 py-1.5">
                <span><span className="font-mono">{x.phone_e164}</span> <span className="text-xs text-slate-500">— {x.reason} · {(x.by as unknown as { full_name: string } | null)?.full_name ?? ""} · {fmtDateTime(x.created_at)}</span></span>
                <RemoveSuppression phone={x.phone_e164} />
              </li>))}</ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Consent history</h2>
          <p className="mb-2 text-xs text-slate-500">Record opt-in/out for a customer from their Customer 360 page.</p>
          {!events?.length ? <Empty title="No consent changes recorded yet" /> : (
            <ul className="divide-y text-sm">{events.map((e) => {
              const c = e.customer as unknown as { id: string; name: string | null; phone_e164: string };
              return (
                <li key={e.id} className="py-1.5">
                  <span className={`badge mr-1 ${e.status === "opt_in" ? "bg-brand-100 text-brand-700" : "bg-red-50 text-red-700"}`}>{e.status === "opt_in" ? "Opt-in" : "Opt-out"}</span>
                  <Link className="text-brand-700 hover:underline" href={`/customers/${c.id}`}>{c.name || c.phone_e164}</Link>
                  <span className="text-xs text-slate-500"> · {e.source}{e.note ? ` — ${e.note}` : ""} · {(e.actor as unknown as { full_name: string } | null)?.full_name ?? "customer"} · {fmtDateTime(e.created_at)}</span>
                </li>
              );
            })}</ul>
          )}
        </section>
      </div>
    </>
  );
}
