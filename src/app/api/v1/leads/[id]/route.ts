import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { apiAuth, apiError, type ApiKey } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Lead id: the UUID, or the lead number ("LB-1234" or "1234"). Only the key's own company. */
async function leadId(key: ApiKey, raw: string): Promise<string | null> {
  const db = createAdminClient();
  const id = decodeURIComponent(raw).trim();
  const q = db.from("lb_leads").select("id").eq("company_id", key.company_id).is("deleted_at", null);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    const { data } = await q.eq("id", id).maybeSingle();
    return data?.id ?? null;
  }
  const m = /^(?:LB-?)?(\d{1,12})$/i.exec(id);
  if (!m) return null;
  const { data } = await q.eq("lead_no", Number(m[1])).maybeSingle();
  return data?.id ?? null;
}

const out = (l: Record<string, unknown>) => ({ ...l, lead_no: `LB-${l.lead_no}` });

/** GET /api/v1/leads/{id}: one lead. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const key = await apiAuth(req, "leads.read");
  if (key instanceof NextResponse) return key;
  const id = await leadId(key, (await params).id);
  if (!id) return apiError(404, "Lead not found");
  const { data, error } = await createAdminClient().rpc("lb__lead_payload", { p_lead: id });
  if (error) return apiError(400, error.message);
  return NextResponse.json({ lead: out(data as Record<string, unknown>) });
}

const Patch = z.object({
  status: z.string().trim().min(1).max(80).optional(),
  reason: z.string().max(500).optional(),
  won_value: z.number().min(0).max(1e11).optional(),
  owner_email: z.union([z.email().max(200), z.literal(""), z.null()]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  expected_value: z.union([z.number().min(0).max(1e11), z.null()]).optional(),
  note: z.string().max(5000).optional(),
  followup_at: z.string().max(40).optional(),
  followup_note: z.string().max(1000).optional(),
}).strict();

/** PATCH /api/v1/leads/{id}: change status / owner / priority / value, add a note or a follow-up. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const key = await apiAuth(req, "leads.update");
  if (key instanceof NextResponse) return key;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError(400, "Body must be JSON"); }
  const p = Patch.safeParse(body);
  if (!p.success) return apiError(422, `${p.error.issues[0]?.path.join(".") || "body"}: ${p.error.issues[0]?.message}`);
  if (!Object.keys(p.data).length) return apiError(422, "Nothing to change");
  const id = await leadId(key, (await params).id);
  if (!id) return apiError(404, "Lead not found");
  const { data, error } = await createAdminClient().rpc("lb_api_update_lead", { p_key: key.id, p_lead: id, p: p.data });
  if (error) {
    if (/not found/i.test(error.message)) return apiError(404, "Lead not found");
    if (/revoked or expired|no leads.update/i.test(error.message)) return apiError(403, error.message);
    return apiError(422, error.message);
  }
  return NextResponse.json({ ok: true, lead: out(data as Record<string, unknown>) });
}
