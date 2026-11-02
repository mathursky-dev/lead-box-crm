import { NextResponse, type NextRequest } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { auditQuery, type AuditFilters } from "@/lib/audit-query";
import { actionLabel, changesOf, nameMaps, subjectOf, type AuditRow } from "@/lib/audit-format";
import { buildXlsx, type Cell } from "@/lib/xlsx";
import { fmtDateTime, istDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX = 10000;

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.profile) return new NextResponse("Unauthorized", { status: 401 });
  if (!isAdmin(s.profile)) return new NextResponse("Admins only", { status: 403 });
  const f = Object.fromEntries(req.nextUrl.searchParams) as AuditFilters;
  const sb = await createClient();
  const names = nameMaps(await loadRefs());
  const rows: AuditRow[] = [];
  for (let off = 0; off < MAX; off += 1000) {
    const { data, error } = await auditQuery(sb, s.profile.company_id, f, off, off + 999);
    if (error) return new NextResponse(error.message, { status: 400 });
    rows.push(...((data ?? []) as unknown as AuditRow[]));
    if (!data || data.length < 1000) break;
  }
  const out: Cell[][] = [["When (IST)", "Who", "What", "Item", "Field", "Old value", "New value", "Action code"]];
  for (const a of rows) {
    const base: Cell[] = [fmtDateTime(a.created_at), a.actor?.full_name ?? "System", actionLabel(a.action), subjectOf(a, names)];
    const ch = changesOf(a, names);
    if (!ch.length) out.push([...base, "", "", "", a.action]);
    for (const c of ch) out.push([...base, c.field, c.from, c.to, a.action]);
  }
  const bytes = buildXlsx([{ name: "Audit log", rows: out }]);
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="audit-log-${istDate()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
