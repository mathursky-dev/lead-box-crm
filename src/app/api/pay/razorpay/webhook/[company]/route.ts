import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { companyRazorpay, syncPaymentLink, verifyHmac } from "@/lib/quotes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Razorpay → Settings → Webhooks of the COMPANY's own account:
//   URL  <APP_URL>/api/pay/razorpay/webhook/<company id>
//   events payment_link.paid, payment_link.partially_paid
// Verified with that company's webhook secret, then the link is re-read from Razorpay.
export async function POST(req: NextRequest, { params }: { params: Promise<{ company: string }> }) {
  const { company } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(company)) return new NextResponse("Not found", { status: 404 });
  const raw = await req.text();
  const keys = await companyRazorpay(company);
  if (!keys?.webhookSecret || !verifyHmac(keys.webhookSecret, raw, req.headers.get("x-razorpay-signature"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let body: { event?: string; payload?: { payment_link?: { entity?: { id?: string; reference_id?: string } } } };
  try { body = JSON.parse(raw); } catch { return new NextResponse("Bad JSON", { status: 400 }); }
  const ent = body.payload?.payment_link?.entity;
  if (!ent?.id || !["payment_link.paid", "payment_link.partially_paid", "payment_link.cancelled", "payment_link.expired"].includes(body.event ?? "")) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const { data: row } = await createAdminClient().from("lb_payment_links").select("id").eq("company_id", company).eq("provider_link_id", ent.id).maybeSingle();
  if (!row) return NextResponse.json({ ok: true, ignored: "unknown link" }); // e.g. a link made outside the CRM
  try {
    await syncPaymentLink(row.id, company);
  } catch (e) {
    console.error("razorpay lead payment sync failed", e);
    return new NextResponse("Sync failed", { status: 500 }); // Razorpay retries
  }
  return NextResponse.json({ ok: true });
}
