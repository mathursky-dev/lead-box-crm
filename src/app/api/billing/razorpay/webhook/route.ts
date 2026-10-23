import { NextResponse, type NextRequest } from "next/server";
import { settlePaymentLink, verifyWebhook } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backup for the callback: Razorpay → Webhooks, event "payment_link.paid".
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-razorpay-signature"))) return new NextResponse("Invalid signature", { status: 401 });
  const body = JSON.parse(raw) as { event?: string; payload?: { payment_link?: { entity?: { id?: string } } } };
  const linkId = body.payload?.payment_link?.entity?.id;
  if (body.event === "payment_link.paid" && linkId) await settlePaymentLink(linkId);
  return NextResponse.json({ ok: true });
}
