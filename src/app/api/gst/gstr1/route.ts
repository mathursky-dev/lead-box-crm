import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, isAdmin } from "@/lib/auth";
import { loadGstr1, monthOk } from "@/lib/gst-server";
import { GSTR1_SECTIONS, gstr1Csv, gstr1Json, type Gstr1Section } from "@/lib/gst";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GSTR-1 download for admins: ?month=YYYY-MM&format=json  or  &format=csv&section=b2b|b2cl|b2cs|hsn_b2b|hsn_b2c|docs
export async function GET(req: NextRequest) {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return new NextResponse("Only admins can download GST returns.", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const month = sp.get("month");
  if (!monthOk(month)) return new NextResponse("Pick a month", { status: 400 });
  const { gstr1, seller } = await loadGstr1(profile.company_id, month!);
  const fp = `${month!.slice(5, 7)}${month!.slice(0, 4)}`;
  const head = (type: string, name: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" });
  if (sp.get("format") === "json") {
    return new NextResponse(JSON.stringify(gstr1Json(gstr1), null, 2), { headers: head("application/json", `GSTR1_${seller.gstin || "NOGSTIN"}_${fp}.json`) });
  }
  const section = sp.get("section") as Gstr1Section;
  if (!GSTR1_SECTIONS.includes(section)) return new NextResponse("Unknown section", { status: 400 });
  return new NextResponse("﻿" + gstr1Csv(gstr1, section), { headers: head("text/csv; charset=utf-8", `GSTR1_${section}_${fp}.csv`) });
}
