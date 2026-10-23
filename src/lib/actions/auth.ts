"use server";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { z } from "zod";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";

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
    if (!data) return { error: "Invalid User ID/email or password." };
    email = data.email;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Invalid User ID/email or password." };
  const { data: profile } = await supabase.from("lb_profiles").select("is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: profile ? "Your account is deactivated. Contact your administrator." : "This account has no LEAD BOX access." };
  }
  // Show the day brief once after each sign-in.
  (await cookies()).set("lb_brief", "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function dismissBrief() {
  (await cookies()).delete("lb_brief");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email." };
  const ip = await clientIp();
  if (!(await rateLimit(`reset:${ip}`, 5, 900))) return { error: "Too many requests. Try again later." };
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
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  redirect("/dashboard");
}
