import { NextResponse, after, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { verifyMetaSignature } from "@/lib/util";
import { processWebhookEvent } from "@/lib/webhook";
import { drainOutbox } from "@/lib/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Connection = { object: "lb_gateway"; session: string; connection: { status: string; phone?: string | null; name?: string | null } };

// Events from the self-hosted wa-gateway (QR-scan numbers), signed with WA_GATEWAY_KEY.
// Messages arrive in Cloud API webhook shape and go through the same pipeline as Meta deliveries.
export async function POST(req: NextRequest) {
  const key = process.env.WA_GATEWAY_KEY;
  if (!hasServiceRole() || !key) return new NextResponse("Not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-lb-signature"), key)) return new NextResponse("Invalid signature", { status: 401 });
  let payload: { object?: string };
  try { payload = JSON.parse(raw); } catch { return new NextResponse("Bad JSON", { status: 400 }); }
  const db = createAdminClient();

  if (payload.object === "lb_gateway") {
    const { session, connection: c } = payload as Connection;
    const connected = c.status === "connected";
    const { error } = await db.from("lb_wa_numbers").update({
      status: connected ? "connected" : "disconnected", last_checked_at: new Date().toISOString(),
      last_error: connected ? null : c.status === "logged_out" ? "Logged out from the phone. Scan the QR again." : `Gateway: ${c.status}`,
      ...(c.phone ? { display_phone: `+${c.phone}` } : {}), ...(c.name ? { verified_name: c.name } : {}),
    }).eq("phone_number_id", session).eq("provider", "qr");
    if (error) return new NextResponse("Storage error", { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const sha = createHash("sha256").update(raw).digest("hex");
  const { data, error } = await db.from("lb_webhook_events").upsert({ body_sha256: sha, payload }, { onConflict: "body_sha256", ignoreDuplicates: true }).select("id");
  if (error) return new NextResponse("Storage error", { status: 500 });
  const id = data?.[0]?.id;
  if (id) {
    after(async () => {
      try { await processWebhookEvent(id); } catch (e) { console.error("gateway event failed; will retry via jobs:", (e as Error).message); }
      await drainOutbox(10000).catch(() => {});
    });
  }
  return NextResponse.json({ ok: true });
}
