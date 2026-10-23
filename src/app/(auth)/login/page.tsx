import Link from "next/link";
import { ActionForm, Field, Submit } from "@/components/ui";
import { login } from "@/lib/actions/auth";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  no_access: "Your account is inactive or has no LEAD BOX access.",
  link_expired: "That link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold text-navy-900">Sign in</h1>
      {error && ERRORS[error] && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{ERRORS[error]}</p>}
      <ActionForm action={login}>
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email or User ID"><input className="input" type="text" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></Field>
        <Field label="Password"><input className="input" type="password" name="password" autoComplete="current-password" required /></Field>
        <Submit className="btn-primary w-full" pendingText="Signing in…">Sign in</Submit>
      </ActionForm>
      <div className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">Forgot password?</Link>
      </div>
    </>
  );
}
