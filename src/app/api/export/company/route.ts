import { NextResponse } from "next/server";
import { getSession, isAdmin, twoFactorGate } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/actions/auth";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 1000;
const MAX_ROWS_PER_TABLE = 200_000;
// Internal / security tables that are not company business data.
const SKIP_TABLES = new Set(["lb_trial_claims", "lb_super_context", "lb_push_subs", "lb_jobs", "lb_alert_queue"]);
// Never export secrets: tokens, encrypted keys, password / key hashes.
const SECRET_COL = /(secret|token|password|passwd|_enc$|hash|private_key|api_key)/i;

const cell = (v: unknown) => {
  let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};
function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "﻿";
  const cols = Object.keys(rows[0]).filter((c) => !SECRET_COL.test(c));
  return "﻿" + [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}

/** One-click backup: every company table as CSV inside a ZIP (Admin → Data export). */
export async function GET() {
  const s = await getSession();
  if (!s?.profile) return new NextResponse("Unauthorized", { status: 401 });
  if (!isAdmin(s.profile)) return new NextResponse("Only company admins can export all data", { status: 403 });
  if (await twoFactorGate()) return new NextResponse("Complete two-factor sign-in first", { status: 403 });
  if (!hasServiceRole()) return new NextResponse("Export is not configured on this server", { status: 503 });
  if (!(await rateLimit(`export-all:${s.profile.company_id}`, 5, 3600))) return new NextResponse("Export limit reached (5 per hour). Try again later.", { status: 429 });

  const companyId = s.profile.company_id;
  const db = createAdminClient();
  const { data: tables, error } = await db.rpc("lb_export_tables");
  if (error) return new NextResponse("Run the new SQL in Supabase first (lb_export_tables).", { status: 503 });

  const files: { name: string; data: string }[] = [];
  const summary: string[] = [];
  const { data: company } = await db.from("lb_companies").select("*").eq("id", companyId).single();
  files.push({ name: "company.csv", data: csv(company ? [company] : []) });

  for (const t of (tables ?? []) as { table_name: string; has_id: boolean }[]) {
    if (SKIP_TABLES.has(t.table_name)) continue;
    const rows: Record<string, unknown>[] = [];
    let note = "";
    for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE) {
      let q = db.from(t.table_name).select("*").eq("company_id", companyId).range(from, from + PAGE - 1);
      if (t.has_id) q = q.order("id");
      const { data, error: e } = await q;
      if (e) { note = ` (error: ${e.message})`; break; }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
      if (from + PAGE >= MAX_ROWS_PER_TABLE) note = ` (first ${MAX_ROWS_PER_TABLE} rows only)`;
    }
    if (!rows.length && !note) continue;
    files.push({ name: `${t.table_name.replace(/^lb_/, "")}.csv`, data: csv(rows) });
    summary.push(`${t.table_name.replace(/^lb_/, "").padEnd(28)} ${String(rows.length).padStart(8)} rows${note}`);
  }
  const stamp = new Date().toISOString();
  files.unshift({ name: "README.txt", data: [
    `Lead Box CRM - full data export`, `Company: ${company?.name ?? companyId}`, `Exported: ${stamp} by ${s.profile.full_name} (${s.profile.email})`, "",
    "Each file is one table (CSV, UTF-8, opens in Excel). Passwords, tokens and secret keys are never included.",
    "Files and recordings stored in Lead Box (documents, media) are listed by their path, not included.", "", ...summary,
  ].join("\r\n") });

  await db.from("lb_audit_log").insert({ company_id: companyId, actor_id: s.profile.id, action: "company.export", entity: "company", entity_id: companyId, data: { tables: files.length - 2 } });
  const body = zip(files);
  const name = `${(company?.slug || company?.name || "company").toString().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-backup-${stamp.slice(0, 10)}.zip`;
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
