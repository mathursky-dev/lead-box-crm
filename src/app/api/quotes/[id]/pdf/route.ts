import { NextResponse, type NextRequest } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { renderQuote } from "@/lib/quotes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PDF of a quotation/invoice for signed-in users who can see its lead (RLS check first).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const { profile } = await requireProfile();
  const { data } = await (await createClient()).from("lb_quotes").select("id").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!data) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderQuote(id, profile.company_id);
  if (!pdf) return new NextResponse("Not found", { status: 404 });
  const disp = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(Buffer.from(pdf.bytes), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `${disp}; filename="${pdf.fileName}"`, "Cache-Control": "private, no-store",
  } });
}
