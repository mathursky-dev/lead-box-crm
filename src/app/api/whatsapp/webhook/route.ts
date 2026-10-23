import { NextResponse, after, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { verifyMetaSignature } from "@/lib/util";
import { processWebhookEvent } from "@/lib/webhook";
import { drainOutbox } from "@/lib/outbox";
import { webhookVerifyTokens, webhookAppSecrets } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Meta verification handshake; accepts the server setting or a token from Admin → Integrations.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const got = p.get("hub.verify_token") ?? "";
  const match = got.length > 0 && (await webhookVerifyTokens()).some((t) => t.length === got.length && timingSafeEqual(Buffer.from(got), Buffer.from(t)));
  if (p.get("hub.mode") === "subscribe" && match) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// Deliveries: verify signature, persist raw (deduped by body hash), ACK fast, process after response.
export async function POST(req: NextRequest) {
  if (!hasServiceRole()) return new NextResponse("Not configured", { status: 503 });
  const secrets = await webhookAppSecrets();
  if (!secrets.length) return new NextResponse("Not configured", { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!secrets.some((s) => verifyMetaSignature(raw, sig, s))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new NextResponse("Bad JSON", { status: 400 }); }

  const db = createAdminClient();
  const sha = createHash("sha256").update(raw).digest("hex");
  const { data, error } = await db.from("lb_webhook_events").upsert({ body_sha256: sha, payload }, { onConflict: "body_sha256", ignoreDuplicates: true }).select("id");
  if (error) return new NextResponse("Storage error", { status: 500 }); // Meta will retry
  const id = data?.[0]?.id;
  if (id) {
    after(async () => {
      try { await processWebhookEvent(id); } catch (e) { console.error("webhook processing failed; will retry via jobs:", (e as Error).message); }
      await drainOutbox(10000).catch(() => {});
    });
  }
  return NextResponse.json({ ok: true });
}
