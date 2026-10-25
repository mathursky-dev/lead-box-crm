import { NextResponse, type NextRequest } from "next/server";
import { getSession, can } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/actions/auth";
import { fmtDateTime, istDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_ROWS = 20000;

const cell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

// WhatsApp contacts (customers) as CSV, same permission and audit rules as the lead export.
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.profile) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(s.profile, "leads.export")) return new NextResponse("You do not have export permission", { status: 403 });
  if (!hasServiceRole()) return new NextResponse("Exports need the audit log (server not configured)", { status: 503 });
  if (!(await rateLimit(`export:${s.profile.id}`, 10, 3600))) return new NextResponse("Export limit reached (10/hour)", { status: 429 });
  const sp = req.nextUrl.searchParams;
  const sb = await createClient();
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    let q = sb.from("lb_customers").select("name,wa_profile_name,phone_e164,email,location,wa_opt_in_at,wa_opted_out_at,created_at");
    const term = (sp.get("q") ?? "").replace(/[%,()]/g, " ").trim();
    if (term) q = q.or(`name.ilike.%${term}%,wa_profile_name.ilike.%${term}%,phone_e164.ilike.%${term}%,email.ilike.%${term}%`);
    if (sp.get("opt") === "in") q = q.is("wa_opted_out_at", null).not("wa_opt_in_at", "is", null);
    if (sp.get("opt") === "out") q = q.not("wa_opted_out_at", "is", null);
    if (sp.get("opt") === "unknown") q = q.is("wa_opted_out_at", null).is("wa_opt_in_at", null);
    const { data, error } = await q.order("created_at", { ascending: false }).range(offset, offset + 999);
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const head = ["Name", "WhatsApp name", "Phone", "Email", "Location", "Opted in", "Opted out", "Created"];
  const body = rows.map((r) => [r.name, r.wa_profile_name, r.phone_e164, r.email, r.location, fmtDateTime(r.wa_opt_in_at as string), fmtDateTime(r.wa_opted_out_at as string), fmtDateTime(r.created_at as string)].map(cell).join(","));
  await createAdminClient().from("lb_audit_log").insert({ company_id: s.profile.company_id, actor_id: s.profile.id, action: "contacts.export", entity: "customers", data: { rows: rows.length } });
  return new NextResponse("﻿" + [head.map(cell).join(","), ...body].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="whatsapp-contacts-${istDate(new Date())}.csv"` },
  });
}
