"use server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin, type Profile, PERMISSIONS } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";

type FormState = { error?: string; ok?: string } | undefined;
type Db = ReturnType<typeof createAdminClient>;

const opt = z.string().trim().transform((v) => v || null).nullable().optional();
const uuidOpt = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);

async function audit(db: Db, me: Profile, action: string, entity: string, entityId: string | null, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action, entity, entity_id: entityId, data });
}

/** Ensure ids belong to the admin's company (service-role writes bypass RLS). */
async function assertOwned(db: Db, companyId: string, refs: Record<string, string | null | undefined>) {
  for (const [table, id] of Object.entries(refs)) {
    if (!id) continue;
    const { data } = await db.from(table).select("id").eq("id", id).eq("company_id", companyId).maybeSingle();
    if (!data) throw new Error("Invalid selection");
  }
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
/** Working hours from the user form: null = any time; otherwise {day: [start, end]} for ticked days (IST). */
function workingHours(form: FormData) {
  if (form.get("hours_mode") !== "custom") return null;
  const out: Record<string, [string, string]> = {};
  for (const d of DAYS) {
    const a = String(form.get(`wh_${d}_from`) ?? ""), b = String(form.get(`wh_${d}_to`) ?? "");
    if (form.get(`wh_${d}`) === "on" && /^\d{2}:\d{2}$/.test(a) && /^\d{2}:\d{2}$/.test(b) && a < b) out[d] = [a, b];
  }
  return out;
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const PASSWORD_MIN = 8;

/** Auth needs an email; User-ID-only accounts get a non-deliverable placeholder address. */
function loginEmail(username: string) {
  let host = "leadbox.local";
  try { host = new URL(process.env.APP_URL ?? "").hostname || host; } catch { /* keep default */ }
  return `${username}@users.${host}`;
}

const userSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.union([z.email(), z.literal("")]).optional().transform((v) => v?.toLowerCase() || null),
  username: z.union([z.string().trim().toLowerCase().regex(USERNAME_RE, "User ID: 3–40 characters, lowercase letters, digits, . _ -"), z.literal("")]).optional().transform((v) => v || null),
  phone: opt,
  role: z.enum(["super_admin", "company_admin", "team_leader", "agent"]),
  branch_id: uuidOpt, department_id: uuidOpt, team_id: uuidOpt,
  allocation_limit: z.string().optional().transform((v) => (v ? Math.max(0, parseInt(v, 10)) : null)),
  accepts_auto_allocation: z.string().optional().transform((v) => v === "on"),
  mode: z.enum(["password", "invite"]).default("password"),
  password: z.string().optional(),
});

export async function createUser(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = userSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const v = p.data;
  if (v.role === "super_admin" && me.role !== "super_admin") return { error: "Only a Super Admin can create Super Admins." };
  if (!v.email && !v.username) return { error: "Enter an email, a User ID, or both." };
  if (v.mode === "invite" && !v.email) return { error: "Email invitations need an email address." };
  const manual = form.get("password_mode") !== "generate";
  if (v.mode === "password" && manual && (v.password ?? "").length < PASSWORD_MIN) return { error: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (v.mode === "password" && manual && v.password !== form.get("password_confirm")) return { error: "Passwords do not match." };
  const permissions = Object.keys(PERMISSIONS).filter((k) => form.get(`perm_${k}`) === "on");
  try {
    const db = createAdminClient();
    await assertOwned(db, me.company_id, { lb_branches: v.branch_id, lb_departments: v.department_id, lb_teams: v.team_id });
    if (v.username && (await db.from("lb_profiles").select("id").eq("username", v.username).maybeSingle()).data) return { error: "That User ID is already taken." };
    const email = v.email ?? loginEmail(v.username!);
    let userId: string;
    let shownPassword: string | null = null;
    if (v.mode === "invite") {
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${process.env.APP_URL ?? "http://localhost:3000"}/auth/confirm?next=/reset-password`,
      });
      if (error) return { error: `Invite failed: ${error.message}` };
      userId = data.user.id;
    } else {
      const password = manual ? v.password! : randomBytes(9).toString("base64url");
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: v.full_name } });
      if (error) return { error: /already/i.test(error.message) ? "A user with this email already exists." : error.message };
      userId = data.user.id;
      if (!manual) shownPassword = password;
    }
    const { error } = await db.from("lb_profiles").insert({
      id: userId, company_id: me.company_id, role: v.role, full_name: v.full_name, email, username: v.username, phone: v.phone,
      branch_id: v.branch_id, department_id: v.department_id, team_id: v.team_id, permissions,
      allocation_limit: v.allocation_limit, accepts_auto_allocation: v.accepts_auto_allocation,
    });
    if (error) {
      await db.auth.admin.deleteUser(userId); // don't leave a login without a profile
      return { error: error.code === "23505" ? "That User ID is already taken." : error.message };
    }
    await audit(db, me, "user.create", "user", userId, { email, username: v.username, role: v.role, mode: v.mode, password: manual ? "set by admin" : "generated" });
    revalidatePath("/admin/users");
    const login = v.username ? `User ID “${v.username}”${v.email ? ` or ${v.email}` : ""}` : email;
    if (v.mode === "invite") return { ok: "Invitation email sent." };
    return { ok: shownPassword
      ? `User created. Sign in with ${login}. Temporary password: ${shownPassword} — share it securely; it is not shown again.`
      : `User created. Sign in with ${login} and the password you set.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Admin sets a user's password directly (no email needed). */
export async function setUserPassword(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  const pw = String(form.get("password") ?? "");
  if (!id.success) return { error: "Invalid user" };
  if (pw.length < PASSWORD_MIN) return { error: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (pw !== form.get("password_confirm")) return { error: "Passwords do not match." };
  try {
    const db = createAdminClient();
    const { data: target } = await db.from("lb_profiles").select("id,company_id,role,email").eq("id", id.data).single();
    if (!target || (target.company_id !== me.company_id && me.role !== "super_admin")) return { error: "User not found" };
    if (target.role === "super_admin" && me.role !== "super_admin") return { error: "Only a Super Admin can change a Super Admin's password." };
    const { error } = await db.auth.admin.updateUserById(target.id, { password: pw });
    if (error) return { error: error.message };
    await audit(db, me, "user.password_set", "user", target.id, { email: target.email });
    return { ok: "Password updated. Share it with the user securely." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function updateUser(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  const p = userSchema.omit({ email: true, username: true, mode: true, password: true }).safeParse(Object.fromEntries(form));
  if (!id.success || !p.success) return { error: p.error?.issues[0]?.message ?? "Invalid input" };
  const v = p.data;
  try {
    const db = createAdminClient();
    const { data: target } = await db.from("lb_profiles").select("*").eq("id", id.data).single();
    if (!target || (target.company_id !== me.company_id && me.role !== "super_admin")) return { error: "User not found" };
    if ((v.role === "super_admin" || target.role === "super_admin") && me.role !== "super_admin") return { error: "Only a Super Admin can change Super Admin roles." };
    if (target.id === me.id && v.role !== me.role) return { error: "You cannot change your own role." };
    await assertOwned(db, target.company_id, { lb_branches: v.branch_id, lb_departments: v.department_id, lb_teams: v.team_id });
    const permissions = Object.keys(PERMISSIONS).filter((k) => form.get(`perm_${k}`) === "on");
    const teamAccess = form.getAll("team_access").map(String).filter(Boolean);
    const backup = String(form.get("backup_user_id") ?? "") || null;
    if (backup === target.id) return { error: "A user cannot be their own backup." };
    if (backup) await assertOwned(db, target.company_id, { lb_profiles: backup });
    for (const t of teamAccess) await assertOwned(db, target.company_id, { lb_teams: t });
    const { error } = await db.from("lb_profiles").update({
      full_name: v.full_name, phone: v.phone, role: v.role, branch_id: v.branch_id, department_id: v.department_id, team_id: v.team_id,
      permissions, allocation_limit: v.allocation_limit, accepts_auto_allocation: v.accepts_auto_allocation, updated_at: new Date().toISOString(),
      working_hours: workingHours(form), backup_user_id: backup,
    }).eq("id", target.id);
    if (error) return { error: error.message };
    await db.from("lb_user_team_access").delete().eq("user_id", target.id);
    if (teamAccess.length) await db.from("lb_user_team_access").insert(teamAccess.map((team_id) => ({ user_id: target.id, team_id })));
    await audit(db, me, "user.update", "user", target.id, { before: { role: target.role, team_id: target.team_id, permissions: target.permissions }, after: { role: v.role, team_id: v.team_id, permissions, teamAccess } });
    revalidatePath("/admin/users");
    return { ok: "Saved." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Deactivation blocks login (auth ban) but keeps ownership and history intact. */
export async function setUserActive(userId: string, active: boolean): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (userId === me.id) return { error: "You cannot deactivate yourself." };
  try {
    const db = createAdminClient();
    const { data: target } = await db.from("lb_profiles").select("id,company_id,role,email").eq("id", userId).single();
    if (!target || (target.company_id !== me.company_id && me.role !== "super_admin")) return { error: "User not found" };
    if (target.role === "super_admin" && me.role !== "super_admin") return { error: "Not permitted" };
    const { error: ae } = await db.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
    if (ae) return { error: ae.message };
    const { error } = await db.from("lb_profiles").update({ is_active: active, deactivated_at: active ? null : new Date().toISOString() }).eq("id", userId);
    if (error) return { error: error.message };
    await audit(db, me, active ? "user.activate" : "user.deactivate", "user", userId, { email: target.email });
    revalidatePath("/admin/users");
    return { ok: active ? "User activated." : "User deactivated." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function sendPasswordReset(userId: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const supabase = await createClient();
  const { data: target } = await supabase.from("lb_profiles").select("email").eq("id", userId).single();
  if (!target) return { error: "User not found" };
  const { error } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${process.env.APP_URL ?? "http://localhost:3000"}/auth/confirm?next=/reset-password`,
  });
  if (error) return { error: error.message };
  await audit(createAdminClient(), me, "user.password_reset_sent", "user", userId);
  return { ok: "Reset email sent." };
}

// ---------------------------------------------------------- org & catalogs
const ORG_TABLES = ["lb_branches", "lb_departments", "lb_teams", "lb_products", "lb_sources", "lb_tags"] as const;
type OrgTable = (typeof ORG_TABLES)[number];

export async function createOrgItem(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const table = form.get("table") as OrgTable;
  if (!ORG_TABLES.includes(table)) return { error: "Invalid type" };
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 100) return { error: "Name is required (max 100 chars)." };
  const row: Record<string, unknown> = { company_id: me.company_id, name };
  for (const k of ["branch_id", "department_id"]) {
    const v = String(form.get(k) ?? "");
    if (v) row[k] = v;
  }
  if (table === "lb_tags" && form.get("color")) row.color = String(form.get("color"));
  const supabase = await createClient(); // RLS: admin-only insert
  const { data, error } = await supabase.from(table).insert(row).select("id").single();
  if (error) return { error: error.code === "23505" ? "That name already exists." : error.message };
  await audit(createAdminClient(), me, "org.create", table, data.id, row);
  revalidatePath("/admin", "layout");
  return { ok: "Added." };
}

export async function toggleOrgItem(table: OrgTable, id: string, active: boolean): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!ORG_TABLES.includes(table) || table === "lb_tags") return { error: "Invalid type" };
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ is_active: active }).eq("id", id);
  if (error) return { error: error.message };
  await audit(createAdminClient(), me, active ? "org.activate" : "org.deactivate", table, id);
  revalidatePath("/admin", "layout");
  return { ok: "Saved." };
}

export async function renameOrgItem(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const table = form.get("table") as OrgTable;
  const id = String(form.get("id"));
  const name = String(form.get("name") ?? "").trim();
  if (!ORG_TABLES.includes(table) || !name) return { error: "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ name }).eq("id", id);
  if (error) return { error: error.code === "23505" ? "That name already exists." : error.message };
  await audit(createAdminClient(), me, "org.rename", table, id, { name });
  revalidatePath("/admin", "layout");
  return { ok: "Renamed." };
}

// ---------------------------------------------------------- statuses
const CATEGORIES = ["new", "assigned", "contacted", "interested", "follow_up", "scheduled", "won", "lost", "invalid"] as const;

export async function saveStatus(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: uuidOpt, name: z.string().trim().min(1).max(60), category: z.enum(CATEGORIES),
    sort_order: z.coerce.number().int().min(0).max(10000), is_active: z.string().optional().transform((v) => v === "on"),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  const supabase = await createClient();
  if (id) {
    const { data: cur } = await supabase.from("lb_lead_statuses").select("is_default,category").eq("id", id).single();
    if (cur?.is_default && (!v.is_active || v.category !== cur.category)) return { error: "The default status of a category cannot be deactivated or re-categorised." };
  }
  const q = id
    ? supabase.from("lb_lead_statuses").update(v).eq("id", id)
    : supabase.from("lb_lead_statuses").insert({ ...v, company_id: me.company_id });
  const { error } = await q;
  if (error) return { error: error.code === "23505" ? "A status with that name exists." : error.message };
  await audit(createAdminClient(), me, id ? "status.update" : "status.create", "status", id ?? null, v);
  revalidatePath("/admin/statuses");
  return { ok: "Saved." };
}

// ---------------------------------------------------------- sub-statuses
export async function saveSubStatus(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: uuidOpt, name: z.string().trim().min(1).max(60), status_id: uuidOpt,
    sort_order: z.coerce.number().int().min(0).max(10000), is_active: z.string().optional().transform((v) => v === "on"),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, ...v } = p.data;
  const supabase = await createClient();
  const q = id
    ? supabase.from("lb_lead_sub_statuses").update(v).eq("id", id).eq("company_id", me.company_id)
    : supabase.from("lb_lead_sub_statuses").insert({ ...v, company_id: me.company_id });
  const { error } = await q;
  if (error) return { error: error.code === "23505" ? "That sub-status already exists under this status." : errMsg(error) };
  await audit(createAdminClient(), me, id ? "sub_status.update" : "sub_status.create", "sub_status", id ?? null, v);
  revalidatePath("/admin/statuses");
  return { ok: "Saved." };
}

export async function deleteSubStatus(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const { error } = await (await createClient()).from("lb_lead_sub_statuses").delete().eq("id", id).eq("company_id", me.company_id);
  if (error) return { error: errMsg(error) };
  await audit(createAdminClient(), me, "sub_status.delete", "sub_status", id);
  revalidatePath("/admin/statuses");
  return { ok: "Deleted." };
}

// ---------------------------------------------------------- company settings
export async function saveCompanySettings(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const v = {
    name: String(form.get("name") ?? "").trim(),
    auto_create_leads: form.get("auto_create_leads") === "on",
    auto_allocate: form.get("auto_allocate") === "on",
  };
  if (!v.name) return { error: "Company name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("lb_companies").update(v).eq("id", me.company_id);
  if (error) return { error: error.message };
  await audit(createAdminClient(), me, "company.settings", "company", me.company_id, v);
  revalidatePath("/", "layout");
  return { ok: "Settings saved." };
}

// ---------------------------------------------------------- quick replies
export async function saveQuickReply(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({ shortcut: z.string().trim().min(1).max(30).regex(/^[\w-]+$/, "Shortcut: letters, digits, - or _"), title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(4000) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("lb_quick_replies").insert({ ...p.data, company_id: me.company_id, created_by: me.id });
  if (error) return { error: error.code === "23505" ? "Shortcut already exists." : error.message };
  revalidatePath("/admin/catalog");
  return { ok: "Quick reply added." };
}

export async function deleteQuickReply(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("lb_quick_replies").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit(createAdminClient(), me, "quick_reply.delete", "quick_reply", id);
  revalidatePath("/admin/catalog");
  return { ok: "Deleted." };
}

// ---------------------------------------------------------- allocation rules
export async function saveRule(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = z.object({
    id: uuidOpt, name: z.string().trim().min(1).max(80), priority: z.coerce.number().int().min(0).max(10000),
    match_number_id: uuidOpt, match_branch_id: uuidOpt, match_department_id: uuidOpt, match_product_id: uuidOpt, match_source_id: uuidOpt,
    strategy: z.enum(["round_robin", "least_loaded"]).default("round_robin"), fallback_to_backup: z.string().optional().transform((v) => v === "on"),
    is_active: z.string().optional().transform((v) => v === "on"),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const users = form.getAll("users").map(String).filter(Boolean);
  if (!users.length) return { error: "Select at least one eligible user." };
  const { id, ...v } = p.data;
  const supabase = await createClient();
  const { data: valid } = await supabase.from("lb_profiles").select("id").in("id", users).eq("company_id", me.company_id);
  if ((valid?.length ?? 0) !== users.length) return { error: "Invalid user selection." };
  let ruleId = id;
  if (id) {
    const { error } = await supabase.from("lb_allocation_rules").update(v).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase.from("lb_allocation_rules").insert({ ...v, company_id: me.company_id }).select("id").single();
    if (error) return { error: error.message };
    ruleId = data.id;
  }
  await supabase.from("lb_allocation_rule_users").delete().eq("rule_id", ruleId!);
  const { error: ue } = await supabase.from("lb_allocation_rule_users").insert(users.map((user_id) => ({ rule_id: ruleId, user_id })));
  if (ue) return { error: ue.message };
  await audit(createAdminClient(), me, id ? "rule.update" : "rule.create", "allocation_rule", ruleId!, { ...v, users });
  revalidatePath("/admin/allocation");
  return { ok: "Rule saved." };
}

export async function deleteRule(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("lb_allocation_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit(createAdminClient(), me, "rule.delete", "allocation_rule", id);
  revalidatePath("/admin/allocation");
  return { ok: "Deleted." };
}

// ---------------------------------------------------------- role permissions
export async function saveRolePermissions(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const supabase = await createClient(); // RLS: admins of this company only
  const { data: catalog, error: ce } = await supabase.from("lb_permission_catalog").select("key");
  if (ce || !catalog) return { error: ce?.message ?? "Could not load permissions" };
  const rows = (["agent", "team_leader"] as const).flatMap((role) =>
    catalog.map((c) => ({ company_id: me.company_id, role, permission: c.key, allowed: form.get(`${role}:${c.key}`) === "on", updated_by: me.id, updated_at: new Date().toISOString() })));
  const { error } = await supabase.from("lb_role_permissions").upsert(rows);
  if (error) return { error: error.message };
  await audit(createAdminClient(), me, "roles.permissions.save", "role_permissions", null,
    Object.fromEntries(rows.map((r) => [`${r.role}:${r.permission}`, r.allowed])));
  revalidatePath("/", "layout");
  return { ok: "Permissions saved. They apply immediately on each user's next page load." };
}
