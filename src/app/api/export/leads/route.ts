import { NextResponse, type NextRequest } from "next/server";
import { getSession, can } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/actions/auth";
import { METRICS, toRpcFilters, pickFilters } from "@/lib/metrics";
import { fmtDateTime, istDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_ROWS = 20000;

// Neutralise spreadsheet formula injection and quote every field.
const cell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.profile) return new NextResponse("Unauthorized", { status: 401 });
  if (!s.entitled) return new NextResponse("Payment required", { status: 402 });
  if (!can(s.profile, "leads.export")) return new NextResponse("You do not have export permission", { status: 403 });
  if (!hasServiceRole()) return new NextResponse("Exports need the audit log (server not configured)", { status: 503 });
  if (!(await rateLimit(`export:${s.profile.id}`, 10, 3600))) return new NextResponse("Export limit reached (10/hour)", { status: 429 });

  const sp = Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>;
  const sb = await createClient();
  const rows: Record<string, unknown>[] = [];
  const metric = sp.metric && (METRICS[sp.metric] || sp.metric.startsWith("status:")) ? sp.metric : null;
  for (let offset = 0; offset < MAX_ROWS; ) {
    const { data, error } = metric
      ? await sb.rpc("lb_metric_leads", { p: toRpcFilters(pickFilters(sp)), p_metric: metric, p_user: sp.mu || null, p_limit: 200, p_offset: offset })
      : await sb.rpc("lb_list_leads", { p: { ...sp, unassigned: sp.unassigned === "1", open_only: sp.open === "1", limit: 500, offset } });
    if (error) return new NextResponse(error.message, { status: 400 });
    rows.push(...data.rows);
    offset += data.rows.length;
    if (!data.rows.length || offset >= data.total) break;
  }

  const cols: [string, string][] = [
    ["lead_no", "Lead ID"], ["customer_name", "Customer Name"], ["phone_e164", "Mobile/WhatsApp"], ["email", "Email"], ["status_name", "Status"], ["sub_status_name", "Sub-status"],
    ["status_category", "Reporting Category"], ["priority", "Priority"], ["owner_name", "Owner"], ["product_name", "Product/Service"], ["source_name", "Source"],
    ["expected_value", "Expected Value"], ["won_value", "Actual Won Value"], ["created_at", "Created At (IST)"], ["assigned_at", "Assigned At (IST)"],
    ["last_activity_at", "Last Activity (IST)"], ["next_followup_at", "Next Follow-up (IST)"], ["converted_at", "Converted At (IST)"],
  ];
  const lines = [cols.map(([, h]) => cell(h)).join(",")];
  for (const r of rows) {
    lines.push(cols.map(([k]) => {
      const v = r[k];
      if (k === "lead_no") return cell(`LB-${v}`);
      if (k.endsWith("_at")) return cell(v ? fmtDateTime(String(v)) : "");
      return cell(v);
    }).join(","));
  }
  await createAdminClient().from("lb_audit_log").insert({
    company_id: s.profile.company_id, actor_id: s.profile.id, action: "leads.export", entity: "lead", data: { rows: rows.length, filters: sp },
  });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leadbox-leads-${istDate()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
