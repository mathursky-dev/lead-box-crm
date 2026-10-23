import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/util";
import { fbApp } from "@/lib/facebook";
import { graph } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

type Token = { access_token: string; expires_in?: number };

// Facebook Login redirect: code → short-lived token → long-lived token → lb_fb_accounts.
export async function GET(req: NextRequest) {
  const { profile } = await requireAdmin();
  const origin = req.nextUrl.origin;
  const p = req.nextUrl.searchParams;
  const back = (error?: string) => {
    const res = NextResponse.redirect(`${origin}/admin/fb-login${error ? `?error=${encodeURIComponent(error)}` : ""}`);
    res.cookies.delete({ name: "lb_fb_state", path: "/api/facebook" });
    return res;
  };
  if (p.get("error")) return back(p.get("error_description") ?? p.get("error")!);
  const state = req.cookies.get("lb_fb_state")?.value;
  if (!state || state !== p.get("state")) return back("Login expired or was tampered with. Please try again.");
  const code = p.get("code");
  if (!code) return back("Facebook did not return a code.");
  const app = await fbApp(profile.company_id).catch(() => null);
  if (!app) return back("Save the Meta App ID and App Secret in Admin → Integrations first.");

  const appToken = `${app.appId}|${app.secret}`;
  const short = await graph<Token>(appToken, `oauth/access_token?${new URLSearchParams({ client_id: app.appId, client_secret: app.secret, redirect_uri: `${origin}/api/facebook/callback`, code })}`);
  if (!short.ok) return back(`Token exchange failed: ${short.message}`);
  const long = await graph<Token>(appToken, `oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.secret, fb_exchange_token: short.data.access_token })}`);
  if (!long.ok) return back(`Long-lived token exchange failed: ${long.message}`);
  const token = long.data.access_token;
  const me = await graph<{ id: string; name: string }>(token, "me?fields=id,name");
  if (!me.ok) return back(`Could not read the Facebook account: ${me.message}`);

  const db = createAdminClient();
  const now = new Date();
  const { error } = await db.from("lb_fb_accounts").upsert({
    company_id: profile.company_id, fb_user_id: me.data.id, fb_user_name: me.data.name, user_token_enc: encryptSecret(token),
    token_expires_at: long.data.expires_in ? new Date(now.getTime() + long.data.expires_in * 1000).toISOString() : null,
    connected_by: profile.id, connected_at: now.toISOString(), updated_at: now.toISOString(),
  });
  if (error) return back(error.message);
  await db.from("lb_audit_log").insert({ company_id: profile.company_id, actor_id: profile.id, action: "integration.facebook.connect", entity: "integration", entity_id: "facebook", data: { fb_user_id: me.data.id } });
  return back();
}
