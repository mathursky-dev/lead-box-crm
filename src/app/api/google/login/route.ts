import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireProfile } from "@/lib/auth";
import { demoBlocked } from "@/lib/demo";
import { authUrl, googleConfigured } from "@/lib/google";

export const dynamic = "force-dynamic";

// Starts Google sign-in so the user can connect their own Gmail; state is checked in /api/google/callback.
export async function GET(req: NextRequest) {
  const { profile } = await requireProfile();
  const origin = req.nextUrl.origin;
  const back = (e: string) => NextResponse.redirect(`${origin}/email?error=${encodeURIComponent(e)}`);
  const demo = await demoBlocked(profile.company_id);
  if (demo) return back(demo);
  if (!googleConfigured()) return back("Gmail is not switched on yet (Google keys missing on the server).");
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(origin, state, profile.email));
  res.cookies.set("lb_g_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}
