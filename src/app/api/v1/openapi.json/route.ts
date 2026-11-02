import { NextResponse, type NextRequest } from "next/server";
import { openApi } from "@/lib/api-docs";

export const dynamic = "force-dynamic";

/** GET /api/v1/openapi.json: the API description for Postman / Swagger (public, no key). */
export function GET(req: NextRequest) {
  const h = req.headers;
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "wacrm.leadboxs.in"}`;
  return NextResponse.json(openApi(origin), { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
