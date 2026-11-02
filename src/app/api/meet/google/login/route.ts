import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { demoBlocked } from "@/lib/demo";
import { GOOGLE_MEET_SCOPES } from "@/lib/meetings";

export const dynamic = "force-dynamic";

// Google sign-in for Google Meet links (calendar events only). State is checked in the callback.
export async function GET(req: NextRequest) {
  const { profile } = await requireAdmin();
  const origin = req.nextUrl.origin;
  const back = (e: string) => NextResponse.redirect(`${origin}/care/meetings?error=${encodeURIComponent(e)}`);
  const demo = await demoBlocked(profile.company_id);
  if (demo) return back(demo);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return back("Google sign-in is not set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const state = randomBytes(16).toString("hex");
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${origin}/api/meet/google/callback`, response_type: "code",
    scope: GOOGLE_MEET_SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  res.cookies.set("lb_meet_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/meet", maxAge: 600 });
  return res;
}
