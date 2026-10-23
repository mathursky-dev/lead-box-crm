import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { fbApp, FB_SCOPES } from "@/lib/facebook";
import { GRAPH_VERSION } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Starts Facebook Login for the admin's company; state is checked in /api/facebook/callback.
export async function GET(req: NextRequest) {
  const { profile } = await requireAdmin();
  const origin = req.nextUrl.origin;
  const app = await fbApp(profile.company_id).catch(() => null);
  if (!app) return NextResponse.redirect(`${origin}/admin/fb-login?error=${encodeURIComponent("Save the Meta App ID and App Secret in Admin → Integrations first.")}`);
  const state = randomBytes(16).toString("hex");
  const q = new URLSearchParams({ client_id: app.appId, redirect_uri: `${origin}/api/facebook/callback`, state, scope: FB_SCOPES, response_type: "code" });
  const res = NextResponse.redirect(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`);
  res.cookies.set("lb_fb_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/facebook", maxAge: 600 });
  return res;
}
