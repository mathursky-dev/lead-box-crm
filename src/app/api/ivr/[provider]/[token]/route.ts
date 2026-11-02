import { NextResponse, after, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { mapCallback, readCallback, storeIvrRecording, type IvrProvider } from "@/lib/ivr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Exotel / Knowlarity call events (click-to-call status callback, incoming IVR passthru, call-end webhook).
// The secret token in the URL picks the company. Always answers 200 so the provider's flow continues.
async function handle(req: NextRequest, ctx: { params: Promise<{ provider: string; token: string }> }) {
  const { provider, token } = await ctx.params;
  const ok = () => new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
  if (!hasServiceRole() || !["exotel", "knowlarity"].includes(provider) || !/^[0-9a-f]{32,80}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const db = createAdminClient();
  const { data: s } = await db.from("lb_ivr_settings").select("company_id,provider,hook_token").eq("hook_token", token).maybeSingle();
  if (!s || s.provider !== provider || !timingSafeEqual(Buffer.from(s.hook_token as string), Buffer.from(token))) return new NextResponse("Not found", { status: 404 });
  const m = await readCallback(req);
  const { data: co } = await db.from("lb_companies").select("default_country").eq("id", s.company_id).maybeSingle();
  const call = mapCallback(provider as IvrProvider, m, (co?.default_country as string) ?? "IN");
  if (!call.call_id) return ok();
  const { data, error } = await db.rpc("lb_ivr_save_call", { p: { ...call, company_id: s.company_id } });
  if (error) { console.error("ivr save failed:", error.message); return ok(); }
  const id = (data as { id?: string })?.id;
  if (id && call.recording_url) {
    after(async () => { await storeIvrRecording(db, { id, company_id: s.company_id as string, provider, recording_url: call.recording_url! }); });
  }
  return ok();
}

export const GET = handle;
export const POST = handle;
