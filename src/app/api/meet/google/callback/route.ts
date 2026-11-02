import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/util";

export const dynamic = "force-dynamic";

// Google sign-in redirect: code -> refresh token -> lb_meeting_accounts.
export async function GET(req: NextRequest) {
  const { profile } = await requireAdmin();
  const origin = req.nextUrl.origin;
  const p = req.nextUrl.searchParams;
  const back = (error?: string) => {
    const res = NextResponse.redirect(`${origin}/care/meetings${error ? `?error=${encodeURIComponent(error)}` : "?ok=google"}`);
    res.cookies.delete({ name: "lb_meet_state", path: "/api/meet" });
    return res;
  };
  if (p.get("error")) return back(p.get("error")!);
  const state = req.cookies.get("lb_meet_state")?.value;
  if (!state || state !== p.get("state")) return back("Sign-in expired. Please try again.");
  const code = p.get("code");
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!code || !id || !secret) return back("Google did not return a code.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: `${origin}/api/meet/google/callback`, grant_type: "authorization_code" }),
  });
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; error_description?: string; error?: string };
  if (!r.ok) return back(`Google: ${j.error_description ?? j.error ?? r.status}`);
  if (!j.refresh_token) return back("Google did not give offline access. Remove Lead Box from your Google account's third-party access and try again.");
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from((j.id_token ?? "").split(".")[1] ?? "", "base64url").toString()).email ?? null; } catch { /* optional */ }
  const { error } = await createAdminClient().from("lb_meeting_accounts").upsert({
    company_id: profile.company_id, google_email: email, google_refresh_enc: encryptSecret(j.refresh_token), updated_by: profile.id, updated_at: new Date().toISOString(),
  }, { onConflict: "company_id" });
  if (error) return back(/lb_meeting_accounts|schema cache/i.test(error.message) ? "Run the meeting links SQL in Supabase first." : error.message);
  return back();
}
