import Link from "next/link";
import { ActionForm, Field, Submit } from "@/components/ui";
import { signup } from "@/lib/actions/auth";

export const metadata = { title: "Start your free trial" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-navy-900">Start your free trial</h1>
      <p className="mb-4 text-sm text-slate-600">24 hours of full access. No card needed.</p>
      <ActionForm action={signup}>
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
