import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { drainOutbox } from "@/lib/outbox";
import { reprocessPendingWebhooks } from "@/lib/webhook";
import { runQueuedJobs } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && a.length >= 16 && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Accepts CRON_SECRET (Vercel Cron / manual) or the token pg_cron sends from the database.
async function authorized(req: NextRequest) {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  if (same(got, process.env.CRON_SECRET ?? "")) return true;
  if (!hasServiceRole()) return false;
  const { data } = await createAdminClient().from("lb_settings").select("value").eq("key", "jobs_token").maybeSingle();
  return Boolean(data?.value && same(got, data.value));
}

// Durable background work: retries queued sends (incl. journey/campaign messages)
// replays unprocessed webhooks and runs queued AI jobs. pg_cron calls it every minute when there is
// work; SLA, journeys, campaigns and reminders run inside the database (lb_nurture_tick).
async function run(req: NextRequest) {
  if (!(await authorized(req))) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasServiceRole()) return NextResponse.json({ error: "Service role not configured" }, { status: 503 });
  const webhooks = await reprocessPendingWebhooks();
  const outbox = await drainOutbox(25000);
  const jobs = await runQueuedJobs();
  return NextResponse.json({ webhooks, outbox, jobs });
}

export const GET = run;
export const POST = run;
