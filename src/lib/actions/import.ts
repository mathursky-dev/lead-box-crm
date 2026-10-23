"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, can } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { normalizePhone } from "@/lib/util";
import { rateLimit } from "./auth";

export type ImportField = "phone" | "name" | "email" | "location" | "product" | "source" | "branch" | "department" | "owner_email" | "priority" | "expected_value" | "notes" | "tags";
type Raw = Partial<Record<ImportField, string>>;
export type PreviewRow = { row: number; status: "new" | "duplicate" | "duplicate_in_file" | "invalid"; reason?: string; phone?: string; name?: string; existing?: string; payload?: Record<string, unknown> };

const MAX_ROWS = 2000;

async function resolve(rows: Raw[]) {
  const refs = await loadRefs();
  const byName = (list: { id: string; name: string }[]) => new Map(list.map((x) => [x.name.trim().toLowerCase(), x.id]));
  const maps = { product: byName(refs.products), source: byName(refs.sources), branch: byName(refs.branches), department: byName(refs.departments), tag: byName(refs.tags) };
  const sb = await createClient();
  const { data: users } = await sb.from("lb_profiles").select("id,email,is_active");
  const userByEmail = new Map((users ?? []).filter((u) => u.is_active).map((u) => [u.email.toLowerCase(), u.id]));
  const seen = new Set<string>();
  const out: PreviewRow[] = rows.map((r, i) => {
    const row = i + 2; // header is line 1
    const phone = normalizePhone(r.phone ?? "");
    if (!phone) return { row, status: "invalid", reason: `Invalid phone "${r.phone ?? ""}"` };
    if (seen.has(phone)) return { row, status: "duplicate_in_file", phone, name: r.name, reason: "Same number earlier in this file" };
    seen.add(phone);
    const errs: string[] = [];
    const email = r.email?.trim();
    if (email && !z.email().safeParse(email).success) errs.push("invalid email");
    const priority = (r.priority ?? "").trim().toLowerCase() || "normal";
    if (!["low", "normal", "high", "urgent"].includes(priority)) errs.push(`invalid priority "${r.priority}"`);
    const ev = (r.expected_value ?? "").replace(/[₹,\s]/g, "");
    if (ev && !(Number(ev) >= 0)) errs.push(`invalid expected value "${r.expected_value}"`);
    const ref = (k: "product" | "source" | "branch" | "department") => {
      const v = r[k]?.trim();
      if (!v) return "";
      const id = maps[k].get(v.toLowerCase());
      if (!id) errs.push(`unknown ${k} "${v}"`);
      return id ?? "";
    };
    const product_id = ref("product"), source_id = ref("source"), branch_id = ref("branch"), department_id = ref("department");
    let owner_id = "";
    if (r.owner_email?.trim()) { owner_id = userByEmail.get(r.owner_email.trim().toLowerCase()) ?? ""; if (!owner_id) errs.push(`unknown/inactive owner "${r.owner_email}"`); }
    const tag_ids = (r.tags ?? "").split(/[,;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean).map((t) => maps.tag.get(t)).filter(Boolean);
    if (errs.length) return { row, status: "invalid", phone, name: r.name, reason: errs.join("; ") };
    return {
      row, status: "new", phone, name: r.name,
      payload: { phone_e164: phone, name: r.name?.trim() ?? "", email: email ?? "", location: r.location?.trim() ?? "", product_id, source_id, branch_id, department_id,
        owner_id, priority, expected_value: ev, notes: r.notes?.trim() ?? "", tag_ids },
    };
  });
  const phones = out.filter((r) => r.status === "new").map((r) => r.phone!);
  for (let i = 0; i < phones.length; i += 500) {
    const { data, error } = await sb.rpc("lb_check_phones", { p_phones: phones.slice(i, i + 500) });
    if (error) throw new Error(error.message);
    const existing = new Map((data as { phone_e164: string; lead_no: number; owner_name: string | null }[]).map((d) => [d.phone_e164, d]));
    for (const r of out) {
      const e = r.phone && existing.get(r.phone);
      if (r.status === "new" && e) { r.status = "duplicate"; r.existing = `LB-${e.lead_no}${e.owner_name ? ` (${e.owner_name})` : ""}`; }
    }
  }
  return out;
}

export async function previewImport(rows: Raw[]): Promise<{ error?: string; rows?: PreviewRow[] }> {
  const { profile } = await requireProfile();
  if (!can(profile, "leads.import")) return { error: "You do not have import permission." };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "The file has no data rows." };
  if (rows.length > MAX_ROWS) return { error: `Max ${MAX_ROWS} rows per import; split the file.` };
  try {
    return { rows: (await resolve(rows)).map(({ payload, ...r }) => (void payload, r)) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function runImport(rows: Raw[], opts: { filename: string; duplicates: "skip" | "repeat"; autoAllocate: boolean }) {
  const { profile } = await requireProfile();
  if (!can(profile, "leads.import")) return { error: "You do not have import permission." };
  if (!hasServiceRole()) return { error: "Import needs the server to be configured (service role key)." };
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) return { error: `Between 1 and ${MAX_ROWS} rows required.` };
  if (!(await rateLimit(`import:${profile.id}`, 10, 3600))) return { error: "Import limit reached (10/hour)." };
  const resolved = await resolve(rows);
  const admin = createAdminClient();
  const { data: job, error: je } = await admin.from("lb_import_jobs").insert({ company_id: profile.company_id, created_by: profile.id, filename: opts.filename.slice(0, 200), total_rows: rows.length }).select("id").single();
  if (je) return { error: je.message };
  const sb = await createClient();
  const results: { row: number; result: string; detail?: string }[] = [];
  const todo = resolved.filter((r) => r.status === "new" || (r.status === "duplicate" && opts.duplicates === "repeat"));
  for (const r of resolved) if (!todo.includes(r)) results.push({ row: r.row, result: r.status === "invalid" ? "error" : "skipped_duplicate", detail: r.reason ?? r.existing });
  // Small concurrency: each create is its own transaction with per-customer locking.
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (r) => {
      const { data, error } = await sb.rpc("lb_create_lead", { p: { ...r.payload, import_job_id: job.id, force_repeat: r.status === "duplicate", auto_allocate: opts.autoAllocate } });
      if (error) results.push({ row: r.row, result: "error", detail: error.message });
      else if (data.status === "duplicate") results.push({ row: r.row, result: "skipped_duplicate", detail: `LB-${data.lead_no}` });
      else results.push({ row: r.row, result: r.status === "duplicate" ? "created_repeat" : "created", detail: `LB-${data.lead_no}` });
    }));
  }
  results.sort((a, b) => a.row - b.row);
  const count = (k: string) => results.filter((x) => x.result === k).length;
  const summary = { created: count("created"), created_repeat: count("created_repeat"), skipped_duplicate: count("skipped_duplicate"), errors: count("error") };
  await admin.from("lb_import_jobs").update({
    created_count: summary.created + summary.created_repeat, duplicate_count: summary.skipped_duplicate, error_count: summary.errors,
    summary: { ...summary, rows: results.filter((x) => x.result !== "created").slice(0, 500) },
  }).eq("id", job.id);
  await admin.from("lb_audit_log").insert({ company_id: profile.company_id, actor_id: profile.id, action: "leads.import", entity: "import_job", entity_id: job.id, data: summary });
  revalidatePath("/leads");
  return { summary, results };
}
