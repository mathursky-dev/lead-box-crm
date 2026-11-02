import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireProfile } from "@/lib/auth";
import { exchangeCode, GOOGLE_SCOPES, gmailProfile, saveAccount, syncAccount } from "@/lib/google";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { profile, homeCompanyId } = await requireProfile();
  const origin = req.nextUrl.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/email?${q}`);
    res.cookies.delete({ name: "lb_g_state", path: "/api/google" });
    return res;
  };
  const p = req.nextUrl.searchParams;
  const want = req.cookies.get("lb_g_state")?.value ?? "";
  const got = p.get("state") ?? "";
  if (!want || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return back("error=" + encodeURIComponent("Sign-in expired. Try again."));
  if (p.get("error")) return back("error=" + encodeURIComponent(p.get("error") === "access_denied" ? "Google access was not given." : p.get("error")!));
  try {
    const t = await exchangeCode(p.get("code") ?? "", origin);
    const granted = (t.scope ?? "").split(" ");
    if (!GOOGLE_SCOPES.split(" ").filter((s) => s.includes("gmail")).every((s) => granted.includes(s)))
      return back("error=" + encodeURIComponent("Please tick both Gmail boxes (read and send) on the Google screen."));
    if (!t.refresh_token) return back("error=" + encodeURIComponent("Google did not give offline access. Remove Lead Box from myaccount.google.com/permissions and connect again."));
    const me = await gmailProfile(t.access_token);
    // A Super Admin viewing another company still connects Gmail to their own company.
    const companyId = profile.role === "super_admin" ? homeCompanyId : profile.company_id;
    await saveAccount({ companyId, userId: profile.id, email: me.emailAddress, refreshToken: t.refresh_token });
    const { data: a } = await createAdminClient().from("lb_google_accounts").select("id").eq("user_id", profile.id).single();
    if (a) await syncAccount(a.id, Date.now() + 30000).catch(() => {});
    return back("connected=1");
  } catch (e) {
    return back("error=" + encodeURIComponent((e as Error).message.slice(0, 200)));
  }
}
