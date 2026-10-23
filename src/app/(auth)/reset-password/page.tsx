import { ActionForm, Field, Submit } from "@/components/ui";
import { updatePassword } from "@/lib/actions/auth";

export const metadata = { title: "Set new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold text-navy-900">Set a new password</h1>
      <ActionForm action={updatePassword}>
        <Field label="New password"><input className="input" type="password" name="password" minLength={8} autoComplete="new-password" required /></Field>
        <Field label="Confirm password"><input className="input" type="password" name="confirm" minLength={8} autoComplete="new-password" required /></Field>
        <Submit className="btn-primary w-full">Update password</Submit>
      </ActionForm>
    </>
  );
}
