import { NextResponse, type NextRequest } from "next/server";
import { razorpayConfigured, settlePaymentLink, verifyCallback } from "@/lib/billing";

export const dynamic = "force-dynamic";

// Razorpay redirects the payer here after a payment-link checkout.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const back = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin));
  if (!razorpayConfigured()) return back("/billing");
  const p = {
    linkId: q.get("razorpay_payment_link_id") ?? "", refId: q.get("razorpay_payment_link_reference_id") ?? "",
    status: q.get("razorpay_payment_link_status") ?? "", paymentId: q.get("razorpay_payment_id") ?? "",
    signature: q.get("razorpay_signature") ?? "",
  };
  if (!p.linkId || !verifyCallback(p)) return back("/billing?error=verify");
  try {
    await settlePaymentLink(p.linkId);
  } catch (e) {
    console.error("razorpay settle failed", e);
    return back("/billing?error=verify");
  }
  return back("/dashboard");
}
