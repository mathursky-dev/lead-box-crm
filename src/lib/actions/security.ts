"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { getSession, requireAdmin, requireProfile } from "@/lib/auth";
import { logLogin } from "@/lib/login-log";
import { rateLimit } from "./auth";
import { DEMO_EMAIL_DOMAIN } from "@/lib/demo";

type FormState = { error?: string; ok?: string } | undefined;
const Code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");
const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

async function me() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

/** Step 2 of sign-in: check the authenticator code and raise the session to aal2. */
export async function verifyTwoFactor(_: FormState, form: FormData): Promise<FormState & { next?: string }> {
  const code = Code.safeParse(form.get("code"));
  if (!code.success) return { error: code.error.issues[0].message };
  const { supabase, user } = await me();
  if (!user) return { error: "Your sign-in expired. Sign in again." };
  if (!(await rateLimit(`otp:${user.id}`, 8, 600))) return { error: "Too many wrong codes. Wait 10 minutes and try again." };
  const { data: f } = await supabase.auth.mfa.listFactors();
  const factor = f?.totp?.[0];
  if (!factor) return { error: "Two-factor is not set up on this account." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  if (error) {
    await logLogin({ userId: user.id, login: user.email, success: false, method: "otp", reason: "wrong code" });
    return { error: "Wrong or expired code. Check your phone's time is automatic and try again." };
  }
  await logLogin({ userId: user.id, login: user.email, success: true, method: "otp" });
  (await cookies()).set("lb_brief", "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  return { ok: "Verified", next: safeNext(form.get("next")) };
}

/** Starts authenticator setup: returns the QR code (SVG data URL) and the text secret. */
export async function startTwoFactorSetup(): Promise<{ error?: string; factorId?: string; qr?: string; secret?: string }> {
  const { supabase, user } = await me();
  if (!user) return { error: "Sign in again." };
  if (user.email?.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) return { error: "The shared demo login cannot turn on two-factor." };
  const { data: f } = await supabase.auth.mfa.listFactors();
  if (f?.totp?.length) return { error: "Two-factor is already on." };
  // Clear half-finished setups so a fresh QR code can be made.
  for (const x of f?.all ?? []) if (x.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Lead Box ${new Date().toISOString().slice(0, 16)}`, issuer: "Lead Box CRM" });
  if (error || !data) return { error: error?.message ?? "Could not start setup. Try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmTwoFactorSetup(factorId: string, rawCode: string, next?: string): Promise<{ error?: string; next?: string }> {
  const code = Code.safeParse(rawCode);
  if (!code.success) return { error: code.error.issues[0].message };
  const { supabase, user } = await me();
  if (!user) return { error: "Sign in again." };
  if (!(await rateLimit(`otp:${user.id}`, 8, 600))) return { error: "Too many wrong codes. Wait 10 minutes and try again." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.data });
  if (error) return { error: "Wrong code. Type the current 6-digit code shown in the app." };
  await logLogin({ userId: user.id, login: user.email, success: true, method: "2fa_setup" });
  revalidatePath("/security");
  return { next: safeNext(next) };
}

/** Turn off your own 2FA (not allowed while your company makes it compulsory). */
export async function disableTwoFactor(): Promise<FormState> {
  const { profile } = await requireProfile({ allowUnpaid: true });
  const { supabase, user } = await me();
  if (!user) return { error: "Sign in again." };
  const { data: co } = await supabase.from("lb_companies").select("require_2fa").eq("id", profile.company_id).maybeSingle();
  if (co?.require_2fa && profile.role !== "super_admin") return { error: "Your company requires two-factor for everyone, so it cannot be turned off." };
  const { data: f } = await supabase.auth.mfa.listFactors();
  for (const x of f?.all ?? []) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: x.id });
    if (error) return { error: error.message };
  }
  await logLogin({ userId: user.id, login: user.email, success: true, method: "2fa_off" });
  revalidatePath("/security");
  return { ok: "Two-factor is off." };
}

/** Signs out every other browser / phone where this account is logged in. */
export async function signOutOtherDevices(): Promise<FormState> {
  await requireProfile({ allowUnpaid: true });
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { error: error.message };
  return { ok: "Signed out from all other devices." };
}

// ---------------------------------------------------------- admin
export async function setRequireTwoFactor(on: boolean): Promise<FormState> {
  const { profile } = await requireAdmin();
  if (!hasServiceRole()) return { error: "Not available right now." };
  const db = createAdminClient();
  const { data: co } = await db.from("lb_companies").select("is_demo").eq("id", profile.company_id).maybeSingle();
  if (co?.is_demo) return { error: "Not available on the demo company." };
  const { error } = await db.from("lb_companies").update({ require_2fa: on }).eq("id", profile.company_id);
  if (error) return { error: /require_2fa/.test(error.message) ? "Run the new SQL in Supabase first." : error.message };
  await db.from("lb_audit_log").insert({ company_id: profile.company_id, actor_id: profile.id, action: on ? "security.2fa.require" : "security.2fa.optional", entity: "company", entity_id: profile.company_id, data: {} });
  revalidatePath("/admin/security");
  return { ok: on ? "Two-factor is now compulsory. Users without it will set it up at their next page load." : "Two-factor is optional again." };
}

/** Removes a user's authenticator (lost phone). They sign in with password only, then can set it up again. */
export async function resetUserTwoFactor(userId: string): Promise<FormState> {
  const { profile } = await requireAdmin();
  if (!z.uuid().safeParse(userId).success || !hasServiceRole()) return { error: "Invalid user." };
  const db = createAdminClient();
  const { data: target } = await db.from("lb_profiles").select("id,company_id,role,email").eq("id", userId).maybeSingle();
  if (!target || (target.company_id !== profile.company_id && profile.role !== "super_admin")) return { error: "User not found." };
  if (target.role === "super_admin" && profile.role !== "super_admin") return { error: "Only a Super Admin can reset this user." };
  const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
  if (error) return { error: error.message };
  for (const f of data?.factors ?? []) {
    const r = await db.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (r.error) return { error: r.error.message };
  }
  await db.from("lb_audit_log").insert({ company_id: profile.company_id, actor_id: profile.id, action: "security.2fa.reset", entity: "user", entity_id: userId, data: { email: target.email } });
  revalidatePath("/admin/security");
  return { ok: "Two-factor removed for this user." };
}

/** Used by the two-factor page to know whether the visitor is signed in at all. */
export async function hasSession() {
  return Boolean((await getSession())?.profile);
}
