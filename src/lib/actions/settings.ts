"use server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin, type Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { FIELD_TYPES, FORM_FONTS, type FormFieldDef } from "@/lib/settings-shared";

type FormState = { error?: string; ok?: string } | undefined;
type Db = ReturnType<typeof createAdminClient>;

// Every write uses the service role and is pinned to the admin's active company
// (profile.company_id follows the Super Admin company switcher).

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = z.string().trim().regex(HEX, "Pick a colour like #3949AB");
const uuidOpt = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);
const on = z.string().optional().transform((v) => v === "on");

async function audit(db: Db, me: Profile, action: string, entity: string, entityId: string | null, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action, entity, entity_id: entityId, data });
}
async function owned(db: Db, cid: string, table: string, id: string | null | undefined) {
  if (!id) return true;
  return Boolean((await db.from(table).select("id").eq("id", id).eq("company_id", cid).maybeSingle()).data);
}
async function nextOrder(db: Db, table: string, cid: string) {
  const { data } = await db.from(table).select("sort_order").eq("company_id", cid).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  return ((data?.sort_order as number | undefined) ?? 0) + 1;
}
const done = (msg: string): FormState => { revalidatePath("/settings", "layout"); revalidatePath("/admin", "layout"); return { ok: msg }; };
const dup = (e: { code?: string; message?: string }, what: string) => (e.code === "23505" ? `${what} with that name already exists.` : errMsg(e));

// ------------------------------------------------------------- reorder
const ORDERABLE = { statuses: "lb_lead_statuses", sources: "lb_sources", fields: "lb_custom_fields" } as const;

/** Save a drag-and-drop order: sequence = position (1, 2, 3 …). */
export async function reorderMaster(kind: keyof typeof ORDERABLE, ids: string[]): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const table = ORDERABLE[kind];
  const p = z.array(z.uuid()).max(500).safeParse(ids);
  if (!table || !p.success) return { error: "Invalid order" };
  const db = createAdminClient();
  for (const [i, id] of p.data.entries()) {
    const { error } = await db.from(table).update({ sort_order: i + 1 }).eq("id", id).eq("company_id", me.company_id);
    if (error) return { error: errMsg(error) };
  }
  await audit(db, me, "settings.reorder", table, null, { n: p.data.length });
  return done("Order saved.");
}

// ------------------------------------------------------------- statuses
const CATEGORIES = ["new", "assigned", "contacted", "interested", "follow_up", "scheduled", "won", "lost", "invalid"] as const;

export async function saveStatusMaster(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({ id: uuidOpt, name: z.string().trim().min(1).max(60), category: z.enum(CATEGORIES), color, is_active: on })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  const db = createAdminClient();
  if (id) {
    const { data: cur } = await db.from("lb_lead_statuses").select("is_default,category").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    if (!cur) return { error: "Status not found" };
    if (cur.is_default && (!v.is_active || v.category !== cur.category)) return { error: "The default status of a category cannot be deactivated or re-categorised." };
    const { error } = await db.from("lb_lead_statuses").update(v).eq("id", id).eq("company_id", me.company_id);
    if (error) return { error: dup(error, "A status") };
  } else {
    const { error } = await db.from("lb_lead_statuses").insert({ ...v, company_id: me.company_id, sort_order: await nextOrder(db, "lb_lead_statuses", me.company_id) });
    if (error) return { error: dup(error, "A status") };
  }
  await audit(db, me, id ? "status.update" : "status.create", "status", id, v);
  return done("Saved.");
}

export async function deleteStatusMaster(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data: s } = await db.from("lb_lead_statuses").select("id,name,is_default").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!s) return { error: "Status not found" };
  if (s.is_default) return { error: "Default statuses cannot be deleted." };
  const { count } = await db.from("lb_leads").select("id", { count: "exact", head: true }).eq("status_id", id);
  if (count) return { error: `${count} lead(s) are in "${s.name}". Move them first, or switch it off instead.` };
  const { count: ev } = await db.from("lb_lead_events").select("id", { count: "exact", head: true }).or(`from_status_id.eq.${id},to_status_id.eq.${id}`);
  if (ev) return { error: `"${s.name}" is in lead history, so it can only be switched off (edit → untick Active).` };
  const { error } = await db.from("lb_lead_statuses").delete().eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(db, me, "status.delete", "status", id, { name: s.name });
  return done("Deleted.");
}

// ------------------------------------------------------------- sources
export async function saveSource(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({ id: uuidOpt, name: z.string().trim().min(1).max(100), color, is_active: on }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  const db = createAdminClient();
  if (id) {
    const { data: cur } = await db.from("lb_sources").select("name,is_system").eq("id", id).eq("company_id", me.company_id).maybeSingle();
    if (!cur) return { error: "Source not found" };
    // System sources (WhatsApp, Manual, Import, Facebook…) are matched by name in the database: colour only.
    const patch = cur.is_system ? { color: v.color } : v;
    const { error } = await db.from("lb_sources").update(patch).eq("id", id).eq("company_id", me.company_id);
    if (error) return { error: dup(error, "A source") };
  } else {
    const { error } = await db.from("lb_sources").insert({ ...v, company_id: me.company_id, sort_order: await nextOrder(db, "lb_sources", me.company_id) });
    if (error) return { error: dup(error, "A source") };
  }
  await audit(db, me, id ? "source.update" : "source.create", "source", id, v);
  return done("Saved.");
}

export async function deleteSource(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data: s } = await db.from("lb_sources").select("name,is_system").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!s) return { error: "Source not found" };
  if (s.is_system) return { error: "Built-in sources cannot be deleted." };
  const { count } = await db.from("lb_leads").select("id", { count: "exact", head: true }).eq("source_id", id);
  if (count) return { error: `${count} lead(s) use "${s.name}". Switch it off instead so history stays correct.` };
  const { error } = await db.from("lb_sources").delete().eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(db, me, "source.delete", "source", id, { name: s.name });
  return done("Deleted.");
}

// ------------------------------------------------------------- tags
export async function saveTag(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({ id: uuidOpt, name: z.string().trim().min(1).max(100), color, description: z.string().trim().max(300).default("") })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  const db = createAdminClient();
  const { error } = id
    ? await db.from("lb_tags").update(v).eq("id", id).eq("company_id", me.company_id)
    : await db.from("lb_tags").insert({ ...v, company_id: me.company_id });
  if (error) return { error: dup(error, "A tag") };
  await audit(db, me, id ? "tag.update" : "tag.create", "tag", id, v);
  return done("Saved.");
}

export async function deleteTags(ids: string[]): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.array(z.uuid()).min(1).max(500).safeParse(ids);
  if (!p.success) return { error: "Select tags first" };
  const db = createAdminClient();
  const { error } = await db.from("lb_tags").delete().in("id", p.data).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(db, me, "tag.delete", "tag", null, { ids: p.data });
  return done(`Deleted ${p.data.length} tag(s).`);
}

// ------------------------------------------------------------- departments
export async function saveDepartment(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({ id: uuidOpt, name: z.string().trim().min(1).max(100), branch_id: uuidOpt, is_active: on }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  const db = createAdminClient();
  if (!(await owned(db, me.company_id, "lb_branches", v.branch_id))) return { error: "Invalid branch" };
  const { error } = id
    ? await db.from("lb_departments").update(v).eq("id", id).eq("company_id", me.company_id)
    : await db.from("lb_departments").insert({ ...v, company_id: me.company_id });
  if (error) return { error: dup(error, "A department") };
  await audit(db, me, id ? "department.update" : "department.create", "department", id, v);
  return done("Saved.");
}

export async function deleteDepartment(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data: d } = await db.from("lb_departments").select("name").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!d) return { error: "Department not found" };
  const [leads, users, teams] = await Promise.all([
    db.from("lb_leads").select("id", { count: "exact", head: true }).eq("department_id", id),
    db.from("lb_profiles").select("id", { count: "exact", head: true }).eq("department_id", id),
    db.from("lb_teams").select("id", { count: "exact", head: true }).eq("department_id", id),
  ]);
  const used = [leads.count && `${leads.count} lead(s)`, users.count && `${users.count} user(s)`, teams.count && `${teams.count} team(s)`].filter(Boolean);
  if (used.length) return { error: `"${d.name}" is used by ${used.join(", ")}. Switch it off instead.` };
  const { error } = await db.from("lb_departments").delete().eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(db, me, "department.delete", "department", id, { name: d.name });
  return done("Deleted.");
}

// ------------------------------------------------------------- custom fields
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) || "field";

export async function saveCustomField(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: uuidOpt, label: z.string().trim().min(1).max(80), field_type: z.enum(FIELD_TYPES.map((t) => t[0]) as [string, ...string[]]),
    options: z.string().default(""), is_required: on, is_active: on,
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, options, ...v } = p.data;
  const opts = [...new Set(options.split(/[\n,]/).map((o) => o.trim()).filter(Boolean))].slice(0, 100);
  if (v.field_type === "dropdown" && opts.length === 0) return { error: "Add at least one choice for a dropdown." };
  const row = { ...v, options: v.field_type === "dropdown" ? opts : [] };
  const db = createAdminClient();
  if (id) {
    const { error } = await db.from("lb_custom_fields").update(row).eq("id", id).eq("company_id", me.company_id);
    if (error) return { error: errMsg(error) };
  } else {
    // Key is fixed at creation (values are stored under it); make it unique.
    const base = slug(v.label);
    const { data: taken } = await db.from("lb_custom_fields").select("key").eq("company_id", me.company_id).like("key", `${base.slice(0, 36)}%`);
    const keys = new Set((taken ?? []).map((t) => t.key as string));
    let key = base, n = 2;
    while (keys.has(key)) key = `${base.slice(0, 36)}_${n++}`;
    const { error } = await db.from("lb_custom_fields").insert({ ...row, key, company_id: me.company_id, sort_order: await nextOrder(db, "lb_custom_fields", me.company_id) });
    if (error) return { error: errMsg(error) };
  }
  await audit(db, me, id ? "custom_field.update" : "custom_field.create", "custom_field", id, row);
  return done("Saved.");
}

export async function deleteCustomField(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { error } = await db.from("lb_custom_fields").delete().eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(db, me, "custom_field.delete", "custom_field", id);
  return done("Deleted.");
}

// ------------------------------------------------------------- forms
const newCode = () => Array.from(randomBytes(6), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
export async function generateFormCode() { await requireAdmin(); return newCode(); }

const fieldSchema = z.object({
  key: z.string().regex(/^(name|phone|email|location|notes|cf:[a-z][a-z0-9_]{0,39})$/),
  label: z.string().trim().min(1).max(80), required: z.boolean().default(false),
});

export async function saveForm(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: uuidOpt, name: z.string().trim().min(1).max(120), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/, "Code: 4–12 letters/digits"),
    description: z.string().trim().max(1000).default(""), thank_you: z.string().trim().max(300).default(""),
    redirect_url: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]).optional().transform((v) => v || null),
    bg_color: color, font: z.enum(FORM_FONTS), title_size: z.coerce.number().int().min(16).max(72), label_size: z.coerce.number().int().min(10).max(24),
    source_id: uuidOpt, product_id: uuidOpt, department_id: uuidOpt, tag_id: uuidOpt, is_active: on, fields: z.string(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const { id, fields: raw, ...v } = p.data;
  let fields: FormFieldDef[];
  try {
    fields = z.array(fieldSchema).min(1).max(40).parse(JSON.parse(raw));
  } catch { return { error: "Add at least one field." }; }
  if (!fields.some((f) => f.key === "phone")) return { error: "A form needs the Mobile number field (leads are matched by phone)." };
  if (new Set(fields.map((f) => f.key)).size !== fields.length) return { error: "A field is added twice." };
  fields = fields.map((f) => (f.key === "phone" ? { ...f, required: true } : f));

  const db = createAdminClient();
  for (const [t, ref] of [["lb_sources", v.source_id], ["lb_products", v.product_id], ["lb_departments", v.department_id], ["lb_tags", v.tag_id]] as const)
    if (!(await owned(db, me.company_id, t, ref))) return { error: "Invalid selection" };
  const cfKeys = fields.filter((f) => f.key.startsWith("cf:")).map((f) => f.key.slice(3));
  if (cfKeys.length) {
    const { data } = await db.from("lb_custom_fields").select("key").eq("company_id", me.company_id).in("key", cfKeys);
    if ((data ?? []).length !== cfKeys.length) return { error: "A custom field on this form no longer exists." };
  }
  const row = { ...v, thank_you: v.thank_you || "Thank you! We will contact you shortly.", fields, updated_at: new Date().toISOString() };
  const { error } = id
    ? await db.from("lb_forms").update(row).eq("id", id).eq("company_id", me.company_id)
    : await db.from("lb_forms").insert({ ...row, company_id: me.company_id, created_by: me.id });
  if (error) return { error: error.code === "23505" ? "That code is taken, generate another." : errMsg(error) };
  await audit(db, me, id ? "form.update" : "form.create", "form", id, { name: v.name, code: v.code });
  return done("Form saved.");
}

export async function deleteForm(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { error } = await db.from("lb_forms").delete().eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(db, me, "form.delete", "form", id);
  return done("Deleted.");
}

export async function toggleForm(id: string, active: boolean): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const { error } = await createAdminClient().from("lb_forms").update({ is_active: active }).eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  return done(active ? "Form is live." : "Form paused.");
}


// ------------------------------------------------------------- lost reasons
export async function saveLostReason(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({ id: uuidOpt, name: z.string().trim().min(1, "Write a reason").max(100), category: z.enum(["lost", "invalid", "any"]), is_active: on })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  const db = createAdminClient();
  const { error } = id
    ? await db.from("lb_lost_reasons").update(v).eq("id", id).eq("company_id", me.company_id)
    : await db.from("lb_lost_reasons").insert({ ...v, is_active: true, company_id: me.company_id, sort_order: await nextOrder(db, "lb_lost_reasons", me.company_id) });
  if (error) return { error: dup(error, "A reason") };
  await audit(db, me, id ? "lost_reason.update" : "lost_reason.create", "lost_reason", id, v);
  return done("Saved.");
}

export async function deleteLostReason(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid reason" };
  const db = createAdminClient();
  const { error } = await db.from("lb_lost_reasons").delete().eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(db, me, "lost_reason.delete", "lost_reason", id);
  return done("Deleted. Leads keep the reason text they already have.");
}
