import "server-only";
import { headers } from "next/headers";
import { createAdminClient, hasServiceRole } from "./supabase/server";

type LoginEvent = { userId?: string | null; companyId?: string | null; login?: string | null; success: boolean; method?: "password" | "otp" | "logout" | "2fa_setup" | "2fa_off"; reason?: string | null };

/** Records a sign-in attempt in lb_login_events. Never throws: a logging problem must not block sign-in. */
export async function logLogin(e: LoginEvent) {
  if (!hasServiceRole()) return;
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
    const db = createAdminClient();
    let companyId = e.companyId ?? null;
    if (!companyId && e.userId) {
      const { data } = await db.from("lb_profiles").select("company_id").eq("id", e.userId).maybeSingle();
      companyId = (data?.company_id as string | undefined) ?? null;
    }
    await db.from("lb_login_events").insert({
      user_id: e.userId ?? null, company_id: companyId, login: e.login?.slice(0, 200) ?? null, success: e.success,
      method: e.method ?? "password", reason: e.reason?.slice(0, 200) ?? null, ip: ip?.slice(0, 64) ?? null,
      user_agent: (h.get("user-agent") ?? "").slice(0, 300) || null,
    });
  } catch {
    // ignore (e.g. table not created yet)
  }
}

/** Short device label from a user-agent string. */
export function deviceLabel(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Other";
  const br = /wv\)|; wv/i.test(ua) ? "App" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}
