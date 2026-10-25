import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { ActionForm, Submit } from "@/components/ui";
import { startCheckout } from "@/lib/actions/billing";
import { logout } from "@/lib/actions/auth";
import { PLAN, activeSeats, razorpayConfigured } from "@/lib/billing";
import { publicPlans, getPlan, priceFor, priceLabel, limitLabel, inr, FEATURES, type Plan } from "@/lib/plans";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { profile, billing, entitled } = await requireProfile({ allowUnpaid: true });
  const seats = await activeSeats(profile.company_id);
  const current = await getPlan(billing?.plan_id);
  const offered = await publicPlans();
  // The company's own plan stays selectable even when it is no longer offered publicly.
  const plans: Plan[] = current && current.is_active && !offered.some((p) => p.id === current.id) ? [current, ...offered] : offered;
  const status = billing?.suspended_at ? "Your account is on hold"
    : billing?.plan === "internal" ? "Active"
    : billing?.paid_until && new Date(billing.paid_until) > new Date() ? `Paid until ${fmtDateTime(billing.paid_until)}`
    : entitled ? `Free trial ends ${fmtDateTime(billing?.trial_ends_at)}` : "Your free trial has ended";
  const canPay = isAdmin(profile) && razorpayConfigured() && !billing?.suspended_at;
  const selected = current?.id ?? plans[0]?.id;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-navy-900">{entitled ? "Your plan" : "Continue with Lead Box"}</h1>
      <p className="mb-4 text-sm text-slate-600">
        {status}{current && billing?.plan !== "internal" ? ` · ${current.name} plan` : ""}.
        {!entitled && !billing?.suspended_at && " Your leads, chats and settings are saved — pay to unlock them."}
        {billing?.suspended_at && " Your data is safe. Contact us to reactivate."}
      </p>
      {error === "verify" && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">We could not confirm that payment yet. If money was deducted, it will show here within a few minutes.</p>}
      {billing?.plan !== "internal" && !billing?.suspended_at && (
        plans.length ? (
          <ActionForm action={startCheckout}>
            <div className="space-y-2">
              {plans.map((p) => (
                <label key={p.id} className="flex cursor-pointer gap-3 rounded-md border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                  <input type="radio" name="plan_id" value={p.id} defaultChecked={p.id === selected} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2"><span className="font-medium text-navy-900">{p.name}{p.id === current?.id && <span className="ml-1 text-xs font-normal text-slate-500">(current)</span>}</span><span className="font-semibold text-navy-900">{inr(priceFor(p, seats))}</span></span>
                    <span className="block text-slate-600">{priceLabel(p)}{p.per_user ? ` · ${seats} active user${seats > 1 ? "s" : ""}` : ""}</span>
                    <span className="block text-xs text-slate-500">Users {limitLabel(p.max_users)} · Numbers {limitLabel(p.max_numbers)} · {p.features.map((f) => FEATURES[f]?.split(" (")[0] ?? f).join(", ")}</span>
                  </span>
                </label>
              ))}
            </div>
            {canPay ? <Submit className="btn-primary w-full" pendingText="Opening payment…">Pay securely</Submit>
              : isAdmin(profile) ? <a className="btn-primary block w-full text-center" href="mailto:support.leadbox@gmail.com?subject=Activate%20my%20Lead%20Box%20plan">Contact us to activate</a>
              : <p className="text-sm text-slate-600">Ask your company admin to renew the plan.</p>}
          </ActionForm>
        ) : (
          <div className="mb-4 rounded-md border border-slate-200 p-3 text-sm">
            <div className="font-medium text-navy-900">Starter CRM</div>
            <div className="text-slate-600">{inr(PLAN.pricePerSeatInr)} per user / year · {seats} active user{seats > 1 ? "s" : ""}</div>
          </div>
        )
      )}
      {billing?.suspended_at && isAdmin(profile) && <a className="btn-primary block w-full text-center" href="mailto:support.leadbox@gmail.com?subject=Reactivate%20my%20Lead%20Box%20account">Contact us</a>}
      <div className="mt-4 flex justify-between text-sm">
        {entitled ? <Link href="/dashboard" className="text-brand-700 hover:underline">Back to dashboard</Link> : <span />}
        <form action={logout}><button className="text-brand-700 hover:underline">Sign out</button></form>
      </div>
    </>
  );
}
