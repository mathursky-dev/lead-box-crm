import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { googleConfigured, syncAll } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && a.length >= 16 && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Same tokens as /api/jobs/run: CRON_SECRET, or the jobs_token pg_cron sends ('lb-email-sync', every 5 minutes).
async function authorized(req: NextRequest) {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  if (same(got, process.env.CRON_SECRET ?? "")) return true;
  if (!hasServiceRole()) return false;
  const { data } = await createAdminClient().from("lb_settings").select("value").eq("key", "jobs_token").maybeSingle();
  return Boolean(data?.value && same(got, data.value));
}

async function run(req: NextRequest) {
  if (!(await authorized(req))) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasServiceRole() || !googleConfigured()) return NextResponse.json({ skipped: "not configured" });
  return NextResponse.json(await syncAll(50000));
}

export const GET = run;
export const POST = run;
