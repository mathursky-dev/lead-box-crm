import Link from "next/link";
import { ActionForm, Field, Submit } from "@/components/ui";
import { signup } from "@/lib/actions/auth";
import { hasServiceRole } from "@/lib/supabase/server";
import { publicPlans, priceLabel } from "@/lib/plans";

export const metadata = { title: "Start your free trial" };

const trialText = (days: number) => (days === 1 ? "24 hours" : `${days} days`);

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan: wanted } = await searchParams;
  const plans = hasServiceRole() ? await publicPlans().catch(() => []) : [];
  const pick = plans.find((p) => p.code === wanted || p.id === wanted) ?? plans[0];
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-navy-900">Start your free trial</h1>
      <p className="mb-4 text-sm text-slate-600">{pick && pick.trial_days > 1 ? `${trialText(pick.trial_days)} of full access` : "24 hours of full access"}. No card needed.</p>
      <ActionForm action={signup}>
        {plans.length > 1 ? (
          <Field label="Plan">
            <select className="input" name="plan" defaultValue={pick?.id}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}: {priceLabel(p)}{p.trial_days ? ` · ${trialText(p.trial_days)} free` : ""}</option>)}
            </select>
          </Field>
        ) : pick ? <input type="hidden" name="plan" value={pick.id} /> : null}
        <Field label="Company name"><input className="input" name="company" autoComplete="organization" required maxLength={120} /></Field>
        <Field label="Your name"><input className="input" name="name" autoComplete="name" required maxLength={120} /></Field>
        <Field label="Work email"><input className="input" type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required /></Field>
        <Field label="Mobile number"><input className="input" type="tel" name="phone" autoComplete="tel" placeholder="+91 98765 43210" required /></Field>
        <Field label="Password" hint="At least 8 characters"><input className="input" type="password" name="password" autoComplete="new-password" minLength={8} required /></Field>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <Submit className="btn-primary w-full" pendingText="Creating your workspace…">Create my workspace</Submit>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-slate-600">Already have an account? <Link href="/login" className="text-brand-700 hover:underline">Sign in</Link></p>
    </>
  );
}
