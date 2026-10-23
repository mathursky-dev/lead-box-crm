import Link from "next/link";
import { ActionForm, Field, Submit } from "@/components/ui";
import { requestPasswordReset } from "@/lib/actions/auth";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-navy-900">Reset password</h1>
      <p className="mb-4 text-sm text-slate-500">We&apos;ll email you a link to set a new password.</p>
      <ActionForm action={requestPasswordReset} resetOnOk>
        <Field label="Email"><input className="input" type="email" name="email" required /></Field>
        <Submit className="btn-primary w-full" pendingText="Sending…">Send reset link</Submit>
      </ActionForm>
      <div className="mt-4 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Back to sign in</Link></div>
    </>
  );
}
