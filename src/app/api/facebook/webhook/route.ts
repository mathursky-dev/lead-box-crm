import { NextResponse, after, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { verifyMetaSignature } from "@/lib/util";
import { processFbLead } from "@/lib/facebook";
import { webhookVerifyTokens, webhookAppSecrets } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Meta verification handshake; same verify tokens as the WhatsApp webhook.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const got = p.get("hub.verify_token") ?? "";
  const match = got.length > 0 && (await webhookVerifyTokens()).some((t) => t.length === got.length && timingSafeEqual(Buffer.from(got), Buffer.from(t)));
  if (p.get("hub.mode") === "subscribe" && match) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

type LeadgenChange = { field: string; value: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; adgroup_id?: string } };

// Page leadgen deliveries: verify signature, store one event per leadgen_id (deduped), ACK fast, fetch lead after response.
export async function POST(req: NextRequest) {
  if (!hasServiceRole()) return new NextResponse("Not configured", { status: 503 });
  const secrets = await webhookAppSecrets();
  if (!secrets.length) return new NextResponse("Not configured", { status: 503 });
  const raw = await req.text();
  if (!secrets.some((s) => verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), s))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let payload: { object?: string; entry?: { changes?: LeadgenChange[] }[] };
  try { payload = JSON.parse(raw); } catch { return new NextResponse("Bad JSON", { status: 400 }); }
  if (payload.object !== "page") return NextResponse.json({ ok: true });

  const db = createAdminClient();
  const ids: string[] = [];
  for (const entry of payload.entry ?? []) {
    for (const c of entry.changes ?? []) {
      const v = c.value;
      if (c.field !== "leadgen" || !v?.leadgen_id) continue;
      const { data: page } = await db.from("lb_fb_pages").select("company_id").eq("page_id", v.page_id ?? "").maybeSingle();
      const { data, error } = await db.from("lb_fb_lead_events").upsert({
        company_id: page?.company_id ?? null, leadgen_id: v.leadgen_id, page_id: v.page_id, form_id: v.form_id, ad_id: v.ad_id, adgroup_id: v.adgroup_id,
        payload: v, ...(page ? {} : { status: "skipped", error: "Unknown page" }),
      }, { onConflict: "leadgen_id", ignoreDuplicates: true }).select("id");
      if (error) { console.error("fb lead event store failed:", error.message); continue; }
      if (page && data?.[0]) ids.push(data[0].id);
    }
  }
  if (ids.length) after(async () => { for (const id of ids) await processFbLead(id); });
  return NextResponse.json({ ok: true });
}
