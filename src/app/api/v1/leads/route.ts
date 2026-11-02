import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { apiAuth, apiError } from "@/lib/api-auth";
import { normalizePhone } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LeadIn = z.object({
  phone: z.union([z.string(), z.number()]).transform(String),
  name: z.string().max(200).optional(), email: z.email().max(200).optional().or(z.literal("")),
  city: z.string().max(200).optional(), location: z.string().max(200).optional(), notes: z.string().max(5000).optional(),
  source: z.string().max(60).optional(), product: z.string().max(120).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(), custom: z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/v1/leads: create a lead (same number with an open lead → logged on that lead, status "duplicate"). */
export async function POST(req: NextRequest) {
  const key = await apiAuth(req, "leads.write");
  if (key instanceof NextResponse) return key;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError(400, "Body must be JSON"); }
  const p = LeadIn.safeParse(body);
  if (!p.success) return apiError(422, `${p.error.issues[0]?.path.join(".") || "body"}: ${p.error.issues[0]?.message}`);
  const db = createAdminClient();
  const { data: co } = await db.from("lb_companies").select("default_country").eq("id", key.company_id).maybeSingle();
  const phone = normalizePhone(p.data.phone.replace(/[\s\-().]/g, ""), co?.default_country ?? "IN");
  if (!phone) return apiError(422, "phone: not a valid mobile number");
  const { name, email, city, location, notes, source, product, tags, custom } = p.data;
  const { data, error } = await db.rpc("lb_api_ingest_lead", {
    p_key: key.id,
    p: { phone_e164: phone, name: name ?? "", email: email ?? "", location: location ?? city ?? "", notes: notes ?? "", source, product, tags, ...(custom ? { custom } : {}), fields: body },
  });
  if (error) return apiError(/Unknown field|must be|invalid/i.test(error.message) ? 422 : 400, error.message);
  const r = data as { status: string; lead_id: string; lead_no: number };
  return NextResponse.json({ ok: true, status: r.status, lead_id: r.lead_id, lead_no: `LB-${r.lead_no}` }, { status: r.status === "created" ? 201 : 200 });
}

/** GET /api/v1/leads?since=ISO&phone=&status=&limit=50&offset=0: newest first. */
export async function GET(req: NextRequest) {
  const key = await apiAuth(req, "leads.read");
  if (key instanceof NextResponse) return key;
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const db = createAdminClient();
  let q = db.from("lb_leads")
    .select("id,lead_no,status_category,priority,expected_value,notes,custom,created_at,updated_at,customer:lb_customers!inner(name,phone_e164,email,location),source:lb_sources(name),product:lb_products(name),status:lb_lead_statuses(name),owner:lb_profiles!lb_leads_owner_id_fkey(full_name,email)", { count: "exact" })
    .eq("company_id", key.company_id).is("deleted_at", null).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  const since = sp.get("since");
  if (since) { if (Number.isNaN(Date.parse(since))) return apiError(422, "since: use an ISO date like 2026-11-01T00:00:00Z"); q = q.gte("updated_at", new Date(since).toISOString()); }
  const phone = sp.get("phone");
  if (phone) { const e = normalizePhone(phone); if (!e) return apiError(422, "phone: not valid"); q = q.eq("customer.phone_e164", e); }
  const cat = sp.get("status");
  if (cat) q = q.eq("status_category", cat);
  const { data, error, count } = await q;
  if (error) return apiError(400, error.message);
  type Row = { id: string; lead_no: number; status_category: string; priority: string; expected_value: number | null; notes: string | null; custom: unknown; created_at: string; updated_at: string;
    customer: { name: string | null; phone_e164: string; email: string | null; location: string | null }; source: { name: string } | null; product: { name: string } | null;
    status: { name: string } | null; owner: { full_name: string; email: string } | null };
  const leads = ((data ?? []) as unknown as Row[]).map((l) => ({
    id: l.id, lead_no: `LB-${l.lead_no}`, name: l.customer.name, phone: l.customer.phone_e164, email: l.customer.email, location: l.customer.location,
    source: l.source?.name ?? null, product: l.product?.name ?? null, status: l.status?.name ?? null, status_category: l.status_category,
    owner: l.owner?.full_name ?? null, owner_email: l.owner?.email ?? null, priority: l.priority, expected_value: l.expected_value, notes: l.notes, custom: l.custom,
    created_at: l.created_at, updated_at: l.updated_at,
  }));
  return NextResponse.json({ total: count ?? leads.length, limit, offset, leads });
}
