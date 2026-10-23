import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, Submit } from "@/components/ui";
import { startCheckout } from "@/lib/actions/billing";
import { logout } from "@/lib/actions/auth";
import { PLAN, razorpayConfigured } from "@/lib/billing";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Billing" };

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { profile, billing, entitled } = await requireProfile({ allowUnpaid: true });
  const { count } = await (await createClient()).from("lb_profiles").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id).eq("is_active", true);
  const seats = Math.max(1, count ?? 1);
  const status = billing?.plan === "internal" ? "Active"
    : billing?.paid_until && new Date(billing.paid_until) > new Date() ? `Paid until ${fmtDateTime(billing.paid_until)}`
    : entitled ? `Free trial ends ${fmtDateTime(billing?.trial_ends_at)}` : "Your free trial has ended";
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-navy-900">{entitled ? "Your plan" : "Continue with Lead Box"}</h1>
      <p className="mb-4 text-sm text-slate-600">{status}.{!entitled && " Your leads, chats and settings are saved — pay to unlock them."}</p>
      {error === "verify" && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">We could not confirm that payment yet. If money was deducted, it will show here within a few minutes.</p>}
      {billing?.plan !== "internal" && (
        <div className="mb-4 rounded-md border border-slate-200 p-3 text-sm">
          <div className="font-medium text-navy-900">Starter CRM</div>
          <div className="text-slate-600">{inr(PLAN.pricePerSeatInr)} per user / year · {seats} active user{seats > 1 ? "s" : ""}</div>
          <div className="mt-1 text-base font-semibold text-navy-900">{inr(PLAN.pricePerSeatInr * seats)}</div>
        </div>
      )}
      {billing?.plan !== "internal" && (isAdmin(profile) && razorpayConfigured() ? (
        <ActionForm action={startCheckout}><Submit className="btn-primary w-full" pendingText="Opening payment…">Pay {inr(PLAN.pricePerSeatInr * seats)} securely</Submit></ActionForm>
      ) : isAdmin(profile) ? (
        <a className="btn-primary block w-full text-center" href="mailto:support.leadbox@gmail.com?subject=Activate%20my%20Lead%20Box%20plan">Contact us to activate</a>
      ) : (
        <p className="text-sm text-slate-600">Ask your company admin to renew the plan.</p>
      ))}
      <div className="mt-4 flex justify-between text-sm">
        {entitled ? <Link href="/dashboard" className="text-brand-700 hover:underline">Back to dashboard</Link> : <span />}
        <form action={logout}><button className="text-brand-700 hover:underline">Sign out</button></form>
      </div>
    </>
  );
}
