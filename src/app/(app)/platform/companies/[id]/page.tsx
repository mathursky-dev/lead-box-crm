import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, ROLE_LABEL, type Role } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel } from "@/components/kit";
import { fmtDateTime, fmtDay } from "@/lib/dates";
import { companyStatus, accessEnds, inr, priceFor, priceLabel, limitLabel, FEATURES, STATUS_BADGE, type BillingRow, type Plan } from "@/lib/plans";
import { ChangePlanForm, TrialForm, ManualPaymentButton, SuspendForm, InternalForm, WalletForm, NotesForm, PasswordButton } from "../../forms";

export const metadata = { title: "Company" };

type Usage = { company_id: string; users: number; numbers: number; leads_month: number; leads_total: number; last_activity: string | null };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile: me } = await requireProfile();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!hasServiceRole()) return <ErrorBox message="SUPABASE_SERVICE_ROLE_KEY is missing on the server." />;
  const db = createAdminClient();
  const [{ data: company }, { data: b }, { data: plans }, { data: usage }, { data: users }, { data: payments }, { data: wallet }, { data: log }] = await Promise.all([
    db.from("lb_companies").select("id,name,slug,created_at").eq("id", id).maybeSingle(),
    db.from("lb_billing").select("*").eq("company_id", id).maybeSingle(),
    db.from("lb_plans").select("*").order("sort"),
    db.rpc("lb_platform_usage"),
    db.from("lb_profiles").select("id,full_name,email,phone,role,is_active,created_at").eq("company_id", id).order("is_active", { ascending: false }).order("created_at"),
    db.from("lb_payments").select("id,provider,amount_paise,seats,period_days,created_at,raw").eq("company_id", id).order("created_at", { ascending: false }).limit(20),
    db.from("lb_wallets").select("balance").eq("company_id", id).maybeSingle(),
    db.from("lb_audit_log").select("action,data,created_at").eq("company_id", id).like("action", "platform.%").order("created_at", { ascending: false }).limit(10),
  ]);
  if (!company) notFound();
  const billing = b as BillingRow | null;
  const allPlans = (plans ?? []) as Plan[];
  const plan = allPlans.find((p) => p.id === billing?.plan_id) ?? null;
  const u = ((usage ?? []) as Usage[]).find((x) => x.company_id === id);
  const s = companyStatus(billing);
  const ends = billing ? accessEnds(billing, s) : null;
  const seats = u?.users ?? 1;
  const over = (n: number | undefined, max: number | null | undefined) => max != null && (n ?? 0) > max;
  const own = id === me.company_id;

  return (
    <>
      <PageHeader icon="building" tone="violet" title={company.name}
        sub={<><Link href="/platform" className="text-brand-700 hover:underline">← All companies</Link> · Joined {fmtDay(company.created_at)}{own && " · your own company"}</>}
        actions={<span className={`badge ${STATUS_BADGE[s][1]}`}>{STATUS_BADGE[s][0]}</span>} />
      {billing?.suspended_at && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          Suspended {fmtDateTime(billing.suspended_at)}{billing.suspended_reason ? `: ${billing.suspended_reason}` : ""}. Users cannot use the CRM; all data is kept.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Access until" value={s === "internal" ? "No expiry" : fmtDay(ends ?? billing?.paid_until ?? billing?.trial_ends_at)} sub={s === "trial" ? "Free trial" : s === "expired" ? "Expired" : undefined} icon="calendar" tone={s === "expired" ? "amber" : "blue"} />
        <Kpi label="Active users" value={<span className={over(u?.users, plan?.max_users) ? "text-red-600" : ""}>{u?.users ?? 0}</span>} sub={`Limit ${limitLabel(plan?.max_users ?? null)}`} icon="contacts" tone="violet" />
        <Kpi label="WhatsApp numbers" value={<span className={over(u?.numbers, plan?.max_numbers) ? "text-red-600" : ""}>{u?.numbers ?? 0}</span>} sub={`Limit ${limitLabel(plan?.max_numbers ?? null)}`} icon="phone" tone="green" />
        <Kpi label="Leads this month" value={<span className={over(u?.leads_month, plan?.max_leads_month) ? "text-red-600" : ""}>{(u?.leads_month ?? 0).toLocaleString("en-IN")}</span>} sub={`Limit ${limitLabel(plan?.max_leads_month ?? null)} · ${(u?.leads_total ?? 0).toLocaleString("en-IN")} total`} icon="target" tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Plan & access" icon="rupee" tone="green"
          sub={plan ? `${plan.name}: ${priceLabel(plan)} · this company ≈ ${inr(priceFor(plan, seats))} per ${plan.period_days} days` : "No plan assigned"}>
          <div className="space-y-4">
            <ChangePlanForm companyId={id} plans={allPlans.filter((p) => p.is_active || p.id === plan?.id).map((p) => ({ id: p.id, name: p.name, trial_days: p.trial_days, period_days: p.period_days }))} current={plan?.id ?? null} />
            {plan && <p className="text-xs text-slate-500">Features: {plan.features.map((f) => FEATURES[f] ?? f).join(", ") || "none"}</p>}
            <TrialForm companyId={id} />
            <div className="flex flex-wrap items-center gap-2">
              <ManualPaymentButton companyId={id} seats={seats} suggested={plan ? priceFor(plan, seats) : 0} days={plan?.period_days ?? 30} />
              <InternalForm companyId={id} internal={billing?.plan === "internal"} />
            </div>
            {!own && <div className="border-t border-slate-100 pt-3"><SuspendForm companyId={id} suspended={Boolean(billing?.suspended_at)} /></div>}
          </div>
        </Panel>

        <Panel title="Wallet" icon="wallet" tone="blue" sub={`Balance ${inr(Math.round(Number(wallet?.balance ?? 0)))} · used for WhatsApp credits`}>
          <WalletForm companyId={id} />
          <div className="mt-5">
            <h3 className="label">Notes (only you see these)</h3>
            <NotesForm companyId={id} notes={billing?.notes ?? null} />
          </div>
        </Panel>

        <Panel title="Users" icon="contacts" tone="violet" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Mobile</th><th className="th">Status</th><th className="th"></th></tr></thead>
              <tbody className="divide-y">
                {(users ?? []).map((x) => (
                  <tr key={x.id} className={x.is_active ? "" : "text-slate-400"}>
                    <td className="td"><div className="font-medium text-navy-900">{x.full_name}</div><div className="text-xs text-slate-500">{x.email}</div></td>
                    <td className="td">{ROLE_LABEL[x.role as Role] ?? x.role}</td>
                    <td className="td">{x.phone ?? "—"}</td>
                    <td className="td">{x.is_active ? "Active" : "Inactive"}</td>
                    <td className="td text-right">{x.id !== me.id && <PasswordButton companyId={id} userId={x.id} name={x.full_name} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Payments" icon="rupee" tone="green">
          {(payments ?? []).length ? (
            <ul className="divide-y text-sm">
              {(payments ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="font-medium text-navy-900">{inr(Number(p.amount_paise) / 100)} · {p.period_days} days</div>
                    <div className="text-xs text-slate-500">{p.provider.replace("manual:", "Manual · ")}{(p.raw as { reference?: string } | null)?.reference ? ` · ${(p.raw as { reference: string }).reference}` : ""}</div>
                  </div>
                  <span className="text-xs text-slate-500">{fmtDateTime(p.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">No payments yet.</p>}
        </Panel>

        <Panel title="Recent admin actions" icon="clock" tone="slate">
          {(log ?? []).length ? (
            <ul className="divide-y text-sm">
              {(log ?? []).map((l, i) => (
                <li key={i} className="flex justify-between gap-3 py-2"><span>{l.action.replace("platform.", "").replace(/_/g, " ")}</span><span className="text-xs text-slate-500">{fmtDateTime(l.created_at)}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Nothing yet.</p>}
        </Panel>
      </div>
    </>
  );
}
