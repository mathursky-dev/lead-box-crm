import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { renderQuote } from "@/lib/quotes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public share link for a quotation/invoice: /q/<64-char token>. Cancelled documents are not served.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const { data } = await createAdminClient().from("lb_quotes").select("id,company_id,status").eq("public_token", token).maybeSingle();
  if (!data || data.status === "cancelled") return new NextResponse("This document is not available.", { status: 404 });
  const pdf = await renderQuote(data.id, data.company_id);
  if (!pdf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.fileName}"`, "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
  } });
}
