import { requireProfile } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { FEATURES, limitLabel, priceLabel, type Plan } from "@/lib/plans";
import { PlanButton } from "../forms";

export const metadata = { title: "Plans & pricing" };

export default async function PlansPage() {
  await requireProfile();
  if (!hasServiceRole()) return <ErrorBox message="SUPABASE_SERVICE_ROLE_KEY is missing on the server." />;
  const db = createAdminClient();
  const [{ data, error }, { data: billing }] = await Promise.all([
    db.from("lb_plans").select("*").order("sort").order("price_inr"),
    db.from("lb_billing").select("plan_id"),
  ]);
  if (error) return <ErrorBox message={error.message} />;
  const used = new Map<string, number>();
  (billing ?? []).forEach((b) => b.plan_id && used.set(b.plan_id, (used.get(b.plan_id) ?? 0) + 1));
  const plans = (data ?? []) as Plan[];
  return (
    <>
      <PageHeader icon="rupee" tone="green" title="Plans & pricing" sub="What you sell: price, free trial, limits and features. Changes apply to every company on the plan."
        actions={<PlanButton features={FEATURES} />} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <section key={p.id} className={`card p-5 ${p.is_active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-navy-900">{p.name}</h2>
                <div className="text-xs text-slate-500">{p.code}{!p.is_public && " · hidden from signup"}{!p.is_active && " · inactive"}</div>
              </div>
              <PlanButton plan={p} features={FEATURES} />
            </div>
            <div className="mt-3 text-xl font-bold text-navy-900">{priceLabel(p)}</div>
            {p.description && <p className="mt-1 text-sm text-slate-600">{p.description}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Free trial</dt><dd>{p.trial_days ? `${p.trial_days} day${p.trial_days > 1 ? "s" : ""}` : "None"}</dd>
              <dt className="text-slate-500">Users</dt><dd>{limitLabel(p.max_users)}</dd>
              <dt className="text-slate-500">WhatsApp numbers</dt><dd>{limitLabel(p.max_numbers)}</dd>
              <dt className="text-slate-500">Leads / month</dt><dd>{limitLabel(p.max_leads_month)}</dd>
              <dt className="text-slate-500">Companies</dt><dd>{used.get(p.id) ?? 0}</dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(FEATURES).map(([k, label]) => (
                <span key={k} className={`badge ${p.features.includes(k) ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-400 line-through"}`}>{label}</span>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">A plan in use cannot be deleted; make it inactive instead. Users and WhatsApp numbers above the limit are blocked; leads are never blocked, only shown as over limit.</p>
    </>
  );
}
