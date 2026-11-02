import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { apiAuth } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/me: check a key; returns the company and the key's scopes. */
export async function GET(req: NextRequest) {
  const key = await apiAuth(req, null);
  if (key instanceof NextResponse) return key;
  const { data: co } = await createAdminClient().from("lb_companies").select("name").eq("id", key.company_id).maybeSingle();
  return NextResponse.json({ ok: true, company: co?.name ?? null, key: key.name, scopes: key.scopes });
}
