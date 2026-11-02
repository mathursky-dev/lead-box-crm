import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TwoFactorVerify, TwoFactorSetup } from "./forms";
import { logout } from "@/lib/actions/auth";

export const metadata = { title: "Two-factor verification" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string; setup?: string }> }) {
  const { next, setup } = await searchParams;
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) redirect("/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const needsCode = aal?.currentLevel === "aal1" && aal.nextLevel === "aal2";
  if (!needsCode && (aal?.currentLevel === "aal2" || !setup)) redirect(target);
  return (
    <>
      {needsCode ? (
        <>
          <h1 className="mb-1 text-lg font-semibold text-navy-900">Enter OTP</h1>
          <p className="mb-4 text-sm text-slate-500">Open your authenticator app (Google Authenticator / Microsoft Authenticator) and type the 6-digit code for Lead Box CRM.</p>
          <TwoFactorVerify next={target} />
        </>
      ) : (
        <>
          <h1 className="mb-1 text-lg font-semibold text-navy-900">Set up two-factor login</h1>
          <p className="mb-4 text-sm text-slate-500">Your company requires an OTP at every sign-in. Install Google Authenticator or Microsoft Authenticator on your phone, then scan the code below.</p>
          <TwoFactorSetup next={target} />
        </>
      )}
      <form action={logout} className="mt-4 text-center text-sm">
        <button className="text-slate-500 hover:underline">Sign out</button>
      </form>
      <p className="mt-2 text-center text-xs text-slate-400">Lost your phone? Ask your company admin to reset two-factor for you.</p>
    </>
  );
}
