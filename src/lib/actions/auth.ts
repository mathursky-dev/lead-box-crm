"use server";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { z } from "zod";
import { getHostBrand } from "@/lib/brand";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { createHash } from "node:crypto";
import { normalizePhone } from "@/lib/util";
import { DEMO_EMAIL_DOMAIN } from "@/lib/demo";
import { logLogin } from "@/lib/login-log";

export type FormState = { error?: string; ok?: string } | undefined;

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/** DB-backed rate limit; returns false when over the limit. */
export async function rateLimit(key: string, max: number, windowSeconds: number) {
  if (!hasServiceRole()) return true;
  const { data, error } = await createAdminClient().rpc("lb_rate_limit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  return error ? true : Boolean(data);
}

const loginSchema = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200), next: z.string().optional() });

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email or User ID and password." };
  const { password, next } = parsed.data;
  const ident = parsed.data.email.toLowerCase();
  const ip = await clientIp();
  if (!(await rateLimit(`login:${ip}`, 20, 600)) || !(await rateLimit(`login:${ident}`, 8, 600))) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }
  // A User ID (no "@") is resolved to its login email server-side.
  let email = ident;
  if (!ident.includes("@")) {
    if (!hasServiceRole()) return { error: "Sign in with your email address." };
    const { data } = await createAdminClient().from("lb_profiles").select("email").eq("username", ident).maybeSingle();
    if (!data) { await logLogin({ login: ident, success: false, reason: "unknown user id" }); return { error: "Invalid User ID/email or password." }; }
    email = data.email;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    let uid: string | null = null;
    if (hasServiceRole()) uid = ((await createAdminClient().from("lb_profiles").select("id").eq("email", email).maybeSingle()).data?.id as string | undefined) ?? null;
    await logLogin({ userId: uid, login: ident, success: false, reason: "wrong password" });
    return { error: "Invalid User ID/email or password." };
  }
  const { data: profile } = await supabase.from("lb_profiles").select("is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active) {
    await logLogin({ userId: profile ? data.user.id : null, login: ident, success: false, reason: profile ? "deactivated" : "no access" });
    await supabase.auth.signOut();
    return { error: profile ? "Your account is deactivated. Contact your administrator." : "This account has no LEAD BOX access." };
  }
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  // Two-factor: the password was right, now the authenticator code is needed (session stays aal1 until then).
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    await logLogin({ userId: data.user.id, login: ident, success: true, reason: "password ok, waiting for OTP" });
    redirect(`/two-factor?next=${encodeURIComponent(target)}`);
  }
  await logLogin({ userId: data.user.id, login: ident, success: true });
  // Show the day brief once after each sign-in.
  (await cookies()).set("lb_brief", "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  redirect(target);
}

export async function dismissBrief() {
  (await cookies()).delete("lb_brief");
}

export async function logout() {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (u.user) await logLogin({ userId: u.user.id, login: u.user.email, success: true, method: "logout" });
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email." };
  const ip = await clientIp();
  if (!(await rateLimit(`reset:${ip}`, 5, 900))) return { error: "Too many requests. Try again later." };
  // Demo logins have no mailbox; never send them email.
  if (email.data.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) return { ok: "If that email has an account, a reset link has been sent." };
  const supabase = await createClient();
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${base}/auth/confirm?next=/reset-password`,
  });
  // Same response whether or not the account exists.
  if (error && !/rate limit/i.test(error.message)) console.error("reset email failed:", error.status);
  if (error && /rate limit/i.test(error.message)) return { error: "Email rate limit reached. Try again later." };
  return { ok: "If that email has an account, a reset link has been sent." };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const pw = String(form.get("password") ?? "");
  if (pw.length < 8) return { error: "Password must be at least 8 characters." };
  if (pw !== form.get("confirm")) return { error: "Passwords do not match." };
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (u.user?.email?.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) return { error: "This is a demo account, so the password cannot be changed." };
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

const signupSchema = z.object({
  company: z.string().trim().min(2, "Enter your company name.").max(120),
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.email("Enter a valid email.").trim().toLowerCase().max(200),
  phone: z.string().trim().min(6, "Enter your mobile number.").max(20),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  website: z.string().max(0).optional(), // honeypot: real users leave it empty
  plan: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
});

/** One trial per person: Gmail dots/+tags and phone formatting don't create new identities. */
function trialIdentities(email: string, phone: string) {
  const [local, domain] = email.split("@");
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  const base = (gmail ? local.replace(/\./g, "") : local).split("+")[0];
  const normEmail = `${base}@${gmail ? "gmail.com" : domain}`;
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  return [hash(`email:${normEmail}`), hash(`phone:${phone}`)];
}

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (!hasServiceRole()) return { error: "Sign-up is not available right now." };
  const { company, name, email, password } = parsed.data;
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return { error: "Enter a valid mobile number." };
  const ip = await clientIp();
  if (!(await rateLimit(`signup:${ip}`, 5, 3600))) return { error: "Too many sign-ups from this network. Try again later." };

  const admin = createAdminClient();
  const identities = trialIdentities(email, phone);
  const { data: used } = await admin.from("lb_trial_claims").select("identity").in("identity", identities).limit(1);
  if (used?.length) return { error: "A free trial was already used with this email or mobile number. Sign in, or contact us to buy a plan." };

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (created.error || !created.data.user) {
    return { error: /already|registered|exists/i.test(created.error?.message ?? "") ? "An account with this email already exists. Sign in instead." : "Could not create your account. Try again." };
  }
  const uid = created.data.user.id;
  const { error } = await admin.rpc("lb_signup", { p_user: uid, p_company: company, p_full_name: name, p_email: email, p_phone: phone, p_identities: identities, p_plan: parsed.data.plan });
  if (error) {
    await admin.auth.admin.deleteUser(uid); // roll back the half-created account
    return { error: /trial_used/.test(error.message) ? "A free trial was already used with this email or mobile number." : "Could not create your workspace. Try again." };
  }
  // Signed up on a white-label partner's domain: the new company belongs to that partner's brand.
  const hostBrand = await getHostBrand();
  if (hostBrand) {
    const { data: prof } = await admin.from("lb_profiles").select("company_id").eq("id", uid).maybeSingle();
    if (prof?.company_id) await admin.from("lb_companies").update({ brand_id: hostBrand.id }).eq("id", prof.company_id);
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect("/login");
  (await cookies()).set("lb_brief", "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  redirect("/onboarding"); // new company: step-by-step setup wizard
}
