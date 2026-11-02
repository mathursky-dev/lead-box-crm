import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { rateLimit } from "./actions/auth";
import { hashKey } from "./lead-hooks";

export type ApiKey = { id: string; company_id: string; name: string; scopes: string[] };
export const apiError = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Authorization: Bearer lbk_… (or X-Api-Key). Returns the key row or an error response. */
export async function apiAuth(req: NextRequest, scope: "leads.read" | "leads.write" | null): Promise<ApiKey | NextResponse> {
  if (!hasServiceRole()) return apiError(503, "Server not configured");
  const raw = (req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "").trim();
  if (!/^lbk_[a-f0-9]{40}$/.test(raw)) return apiError(401, "Missing or invalid API key");
  const db = createAdminClient();
  const { data: k } = await db.from("lb_api_keys").select("id,company_id,name,scopes,revoked_at,last_used_at").eq("key_hash", hashKey(raw)).maybeSingle();
  if (!k || k.revoked_at) return apiError(401, "Missing or invalid API key");
  if (scope && !(k.scopes as string[]).includes(scope)) return apiError(403, `This key has no ${scope} permission`);
  if (!(await rateLimit(`api:${k.id}`, 120, 60))) return apiError(429, "Rate limit: 120 requests per minute");
  const { data: ok } = await db.rpc("lb_company_entitled", { p_company: k.company_id });
  if (ok === false) return apiError(402, "Company plan is not active");
  if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 60_000) {
    await db.from("lb_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
  }
  return { id: k.id, company_id: k.company_id, name: k.name, scopes: k.scopes as string[] };
}
