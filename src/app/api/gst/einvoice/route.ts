import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, isAdmin } from "@/lib/auth";
import { gstInvoices, monthOk } from "@/lib/gst-server";
import { quoteSettings, sellerOf } from "@/lib/quotes-server";
import { einvoiceJson, einvoiceProblems } from "@/lib/gst";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// e-invoice JSON (NIC schema 1.1) for admins: ?id=<invoice>  or  ?month=YYYY-MM (all ready B2B invoices without an IRN).
export async function GET(req: NextRequest) {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return new NextResponse("Only admins can download e-invoice files.", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id"), month = sp.get("month");
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  if (!id && !monthOk(month)) return new NextResponse("Pick a month or an invoice", { status: 400 });
  const seller = sellerOf(await quoteSettings(profile.company_id));
  const list = (await gstInvoices(profile.company_id, id ? { ids: [id] } : { month: month! })).filter((i) => i.status !== "cancelled");
  if (id) {
    const inv = list[0];
    if (!inv) return new NextResponse("Not found", { status: 404 });
    const problems = einvoiceProblems(inv, seller);
    if (problems.length) return new NextResponse(`Can't make the e-invoice yet:\n- ${problems.join("\n- ")}`, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new NextResponse(JSON.stringify([einvoiceJson(inv, seller)], null, 2), { headers: {
      "Content-Type": "application/json", "Content-Disposition": `attachment; filename="einvoice_${inv.doc_no.replace(/[^\w.-]/g, "_")}.json"`, "Cache-Control": "private, no-store",
    } });
  }
  const ready = list.filter((i) => !i.irn && einvoiceProblems(i, seller).length === 0);
  return new NextResponse(JSON.stringify(ready.map((i) => einvoiceJson(i, seller)), null, 2), { headers: {
    "Content-Type": "application/json", "Content-Disposition": `attachment; filename="einvoice_${month}.json"`, "Cache-Control": "private, no-store",
  } });
}
