"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, can } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { fetchAll } from "@/lib/analytics";
import { resolvePeriod } from "@/lib/periods";
import { errMsg } from "@/lib/util";
import { DIMS, MEASURES, DATE_FIELDS, CHARTS, type Dim, type Measure, type ReportResult, type ReportSpec } from "@/lib/report-spec";

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const ids = z.array(z.uuid()).max(200).default([]);
const Spec = z.object({
  rows: z.enum(keys(DIMS)), cols: z.union([z.enum(keys(DIMS)), z.literal("")]).default(""),
  measures: z.array(z.enum(keys(MEASURES))).min(1).max(9), date: z.enum(keys(DATE_FIELDS)),
  preset: z.string().max(20), from: z.string().max(10).optional(), to: z.string().max(10).optional(),
  chart: z.enum(keys(CHARTS)), status_ids: ids, source_ids: ids, owner_ids: ids, product_ids: ids,
});

type Row = {
  id: string; created_at: string; closed_at: string | null; converted_at: string | null; status_id: string; status_category: string;
  sub_status_id: string | null; source_id: string | null; owner_id: string | null; team_id: string | null; product_id: string | null;
  branch_id: string | null; department_id: string | null; priority: string; number_id: string | null; ai_score: string | null;
  lost_reason: string | null; expected_value: number | null; won_value: number | null; customer: { location: string | null } | null;
};
const COLS = "id,created_at,closed_at,converted_at,status_id,status_category,sub_status_id,source_id,owner_id,team_id,product_id,branch_id,department_id,priority,number_id,ai_score,lost_reason,expected_value,won_value,customer:lb_customers(location)";
const CLOSED = new Set(["won", "lost", "invalid"]);
const STAGE: Record<string, string> = { new: "New", assigned: "Assigned", contacted: "Contacted", interested: "Interested", follow_up: "Follow-up", scheduled: "Scheduled", won: "Won", lost: "Lost", invalid: "Invalid" };
const IST = 19800000;
const istYmd = (iso: string) => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10);

export async function runReport(input: ReportSpec): Promise<ReportResult> {
  const { profile } = await requireProfile();
  const empty = { total: 0, from: "", to: "", rowKeys: [], colKeys: [], cells: {}, totals: {} };
  if (!can(profile, "reports.view")) return { ...empty, error: "You do not have report access" };
  const p = Spec.safeParse(input);
  if (!p.success) return { ...empty, error: p.error.issues[0]?.message ?? "Invalid report" };
  const s = p.data;
  const per = resolvePeriod({ preset: s.preset, from: s.from, to: s.to }, "30");
  const sb = await createClient();
  const refs = await loadRefs();

  const { rows, error } = await fetchAll<Row>((a, b) => {
    let q = sb.from("lb_leads").select(COLS).eq("company_id", profile.company_id).is("merged_into", null)
      .gte(s.date, per.start).lt(s.date, per.end).order(s.date, { ascending: true }).range(a, b);
    if (s.status_ids.length) q = q.in("status_id", s.status_ids);
    if (s.source_ids.length) q = q.in("source_id", s.source_ids);
    if (s.owner_ids.length) q = q.in("owner_id", s.owner_ids);
    if (s.product_ids.length) q = q.in("product_id", s.product_ids);
    return q as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  }, 20000);
  if (error) return { ...empty, error };

  const nm = (list: { id: string; name?: string; full_name?: string; label?: string }[]) => new Map(list.map((x) => [x.id, x.name ?? x.full_name ?? x.label ?? ""]));
  const names: Partial<Record<Dim, Map<string, string>>> = {
    status: nm(refs.statuses), sub_status: nm(refs.subStatuses), source: nm(refs.sources), owner: nm(refs.users), team: nm(refs.teams),
    product: nm(refs.products), branch: nm(refs.branches), department: nm(refs.departments), number: nm(refs.numbers),
  };
  const order: Partial<Record<Dim, Map<string, number>>> = { status: new Map(refs.statuses.map((x) => [x.id, x.sort_order])) };
  const NONE = "—";
  const keyOf = (r: Row, d: Dim): [string, string] => {
    const dateIso = (r[s.date] as string | null) ?? r.created_at;
    switch (d) {
      case "stage": return [r.status_category, STAGE[r.status_category] ?? r.status_category];
      case "priority": return [r.priority, r.priority.charAt(0).toUpperCase() + r.priority.slice(1)];
      case "ai_score": return [r.ai_score ?? "", r.ai_score ? r.ai_score.charAt(0).toUpperCase() + r.ai_score.slice(1) : "Not scored"];
      case "lost_reason": { const v = CLOSED.has(r.status_category) && r.status_category !== "won" ? (r.lost_reason?.trim() || "No reason given") : ""; return [v.toLowerCase(), v || "Not lost"]; }
      case "location": { const v = r.customer?.location?.trim() ?? ""; return [v.toLowerCase(), v || NONE]; }
      case "day": { const v = istYmd(dateIso); return [v, v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4)]; }
      case "week": {
        const v = istYmd(dateIso); const d0 = new Date(v + "T00:00:00Z"); d0.setUTCDate(d0.getUTCDate() - ((d0.getUTCDay() + 6) % 7));
        const w = d0.toISOString().slice(0, 10); return [w, "Week of " + w.slice(8, 10) + "/" + w.slice(5, 7)];
      }
      case "month": { const v = istYmd(dateIso).slice(0, 7); return [v, new Date(v + "-01T12:00:00Z").toLocaleString("en-IN", { month: "short", year: "numeric" })]; }
      default: {
        const id = (r as unknown as Record<string, string | null>)[{ status: "status_id", sub_status: "sub_status_id", source: "source_id", owner: "owner_id", team: "team_id", product: "product_id", branch: "branch_id", department: "department_id", number: "number_id" }[d]];
        return [id ?? "", id ? names[d]?.get(id) ?? "Unknown" : d === "owner" ? "Unassigned" : NONE];
      }
    }
  };

  type Acc = { leads: number; open: number; won: number; lost: number; invalid: number; expected_value: number; won_value: number };
  const acc = new Map<string, Map<string, Acc>>();
  const rowLabels = new Map<string, string>(); const colLabels = new Map<string, string>();
  const blank = (): Acc => ({ leads: 0, open: 0, won: 0, lost: 0, invalid: 0, expected_value: 0, won_value: 0 });
  const all = blank();
  const add = (a: Acc, r: Row) => {
    a.leads++; a.expected_value += Number(r.expected_value ?? 0);
    if (r.status_category === "won") { a.won++; a.won_value += Number(r.won_value ?? 0); }
    else if (r.status_category === "lost") a.lost++;
    else if (r.status_category === "invalid") a.invalid++;
    else a.open++;
  };
  for (const r of rows) {
    const [rk, rl] = keyOf(r, s.rows); rowLabels.set(rk, rl);
    let ck = "_";
    if (s.cols) { const [k, l] = keyOf(r, s.cols); ck = k; colLabels.set(k, l); }
    const m = acc.get(rk) ?? new Map<string, Acc>(); acc.set(rk, m);
    const a = m.get(ck) ?? blank(); m.set(ck, a);
    add(a, r);
    if (s.cols) { const t = m.get("_") ?? blank(); m.set("_", t); add(t, r); }
    add(all, r);
  }
  const out = (a: Acc): Partial<Record<Measure, number>> => {
    const o: Partial<Record<Measure, number>> = {};
    for (const m of s.measures) {
      o[m] = m === "win_rate" ? (a.won + a.lost ? Math.round((a.won / (a.won + a.lost)) * 1000) / 10 : 0)
        : m === "avg_won_value" ? (a.won ? Math.round(a.won_value / a.won) : 0)
        : Math.round(a[m] * 100) / 100;
    }
    return o;
  };
  const cells: ReportResult["cells"] = {};
  for (const [rk, m] of acc) { cells[rk] = {}; for (const [ck, a] of m) cells[rk][ck] = out(a); }

  const timeDim = (d: Dim) => d === "day" || d === "week" || d === "month";
  const sortKeys = (d: Dim, labels: Map<string, string>, size: (k: string) => number) => [...labels.keys()].sort((a, b) =>
    timeDim(d) ? a.localeCompare(b)
      : d === "status" ? (order.status?.get(a) ?? 999) - (order.status?.get(b) ?? 999)
      : size(b) - size(a) || (labels.get(a) ?? "").localeCompare(labels.get(b) ?? "")).map((key) => ({ key, label: labels.get(key) ?? key }));
  const rowSize = (k: string) => acc.get(k)?.get("_")?.leads ?? 0;
  const colSize = (k: string) => [...acc.values()].reduce((t, m) => t + (m.get(k)?.leads ?? 0), 0);

  return {
    total: rows.length, truncated: rows.length >= 20000, from: per.from, to: per.to,
    rowKeys: sortKeys(s.rows, rowLabels, rowSize), colKeys: s.cols ? sortKeys(s.cols, colLabels, colSize).slice(0, 30) : [],
    cells, totals: out(all),
  };
}

// --------------------------------------------------------------- saved reports
export async function saveReport(name: string, spec: ReportSpec, shared: boolean, id?: string | null): Promise<{ error?: string; ok?: string; id?: string }> {
  const { profile } = await requireProfile();
  if (!can(profile, "reports.view")) return { error: "You do not have report access" };
  const p = Spec.safeParse(spec);
  const n = z.string().trim().min(1, "Give the report a name").max(100).safeParse(name);
  if (!p.success || !n.success) return { error: (n.error ?? p.error)?.issues[0]?.message ?? "Invalid report" };
  const db = createAdminClient();
  const row = { name: n.data, spec: p.data, is_shared: shared && profile.role !== "agent", updated_at: new Date().toISOString() };
  const r = id
    ? await db.from("lb_saved_reports").update(row).eq("id", id).eq("company_id", profile.company_id).eq("user_id", profile.id).select("id").maybeSingle()
    : await db.from("lb_saved_reports").insert({ ...row, company_id: profile.company_id, user_id: profile.id }).select("id").maybeSingle();
  if (r.error) return { error: errMsg(r.error) };
  if (!r.data) return { error: "Only the person who saved a report can change it. Save it as a new report instead." };
  revalidatePath("/report-builder");
  return { ok: "Report saved.", id: r.data.id as string };
}

export async function deleteReport(id: string): Promise<{ error?: string; ok?: string }> {
  const { profile } = await requireProfile();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid report" };
  const db = createAdminClient();
  const { data, error } = await db.from("lb_saved_reports").delete().eq("id", id).eq("company_id", profile.company_id).eq("user_id", profile.id).select("id");
  if (error) return { error: errMsg(error) };
  if (!data?.length) return { error: "Only the person who saved a report can delete it." };
  revalidatePath("/report-builder");
  return { ok: "Deleted." };
}
