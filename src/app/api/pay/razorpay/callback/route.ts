import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { companyRazorpay, syncPaymentLink, verifyHmac } from "@/lib/quotes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Razorpay sends the customer here after paying a lead's payment link (?c=<company id>).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const done = (status: string) => NextResponse.redirect(new URL(`/paid?status=${status}`, req.nextUrl.origin));
  const company = q.get("c") ?? "";
  const p = {
    linkId: q.get("razorpay_payment_link_id") ?? "", refId: q.get("razorpay_payment_link_reference_id") ?? "",
    status: q.get("razorpay_payment_link_status") ?? "", paymentId: q.get("razorpay_payment_id") ?? "", signature: q.get("razorpay_signature") ?? "",
  };
  if (!/^[0-9a-f-]{36}$/i.test(company) || !p.linkId) return done("unknown");
  const keys = await companyRazorpay(company);
  if (!keys || !verifyHmac(keys.secret, `${p.linkId}|${p.refId}|${p.status}|${p.paymentId}`, p.signature)) return done("unknown");
  const { data: row } = await createAdminClient().from("lb_payment_links").select("id").eq("company_id", company).eq("provider_link_id", p.linkId).maybeSingle();
  if (!row) return done("unknown");
  try {
    const r = await syncPaymentLink(row.id, company);
    return done(r.status === "paid" || r.status === "partially_paid" ? "paid" : "pending");
  } catch (e) {
    console.error("razorpay lead payment callback failed", e);
    return done("pending");
  }
}
