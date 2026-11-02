"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { normalizePhone, errMsg } from "@/lib/util";

type FormState = { error?: string; ok?: string } | undefined;
type Db = ReturnType<typeof createAdminClient>;

const BUCKET = "lb-brand";
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };
const MAX_IMAGE = 1024 * 1024;

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colours must look like #15803d.");
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optUrl = z.string().trim().max(500).optional().transform((v) => v || null)
  .refine((v) => !v || /^https?:\/\//.test(v), "Website must start with https://");

/** Look fields shared by the platform form and the reseller form. */
const lookSchema = z.object({
  name: z.string().trim().min(2, "Enter the brand name.").max(80),
  tagline: optText(120),
  primary_color: hex,
  sidebar_color: hex,
  support_email: z.union([z.email("Enter a valid support email."), z.literal("")]).optional().transform((v) => v || null),
  support_phone: optText(30),
  website: optUrl,
});

/** Uploads a logo / icon file from the form (if one was chosen) and returns its public URL. */
async function uploadImage(db: Db, brandId: string, file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new Error("Logo must be a PNG, JPG, WEBP or ICO image.");
  if (file.size > MAX_IMAGE) throw new Error("Logo must be smaller than 1 MB.");
  const path = `${brandId}/${randomUUID()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** "Remove" ticked -> clear; new file -> its URL; else keep (undefined). */
async function imageField(db: Db, brandId: string, form: FormData, key: "logo" | "icon") {
  if (form.get(`${key}_remove`) === "on") return null;
  const url = await uploadImage(db, brandId, form.get(key));
  return url ?? undefined;
}

// ------------------------------------------------------------- platform (Super Admin)

async function requireSuper() {
  const { profile } = await requireProfile();
  if (profile.role !== "super_admin") redirect("/dashboard");
  if (!hasServiceRole()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing on the server.");
  return { me: profile, db: createAdminClient() };
}

const platformSchema = lookSchema.extend({
  id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
  domain: z.string().trim().toLowerCase().max(200).optional()
    .transform((v) => (v ? v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "") : null))
    .refine((v) => !v || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v), "Domain looks wrong. Example: crm.partner.com"),
  owner_company_id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
  default_plan_id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null),
  hide_powered_by: z.string().optional().transform((v) => v === "on"),
  is_active: z.string().optional().transform((v) => v === "on"),
});

export async function saveBrand(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = platformSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const { id, ...v } = p.data;
    const brandId = id ?? randomUUID();
    const logo_url = await imageField(db, brandId, form, "logo");
    const icon_url = await imageField(db, brandId, form, "icon");
    const row = { ...v, updated_at: new Date().toISOString(), ...(logo_url !== undefined ? { logo_url } : {}), ...(icon_url !== undefined ? { icon_url } : {}) };
    const { error } = id
      ? await db.from("lb_brands").update(row).eq("id", id)
      : await db.from("lb_brands").insert({ id: brandId, ...row });
    if (error) return { error: error.code === "23505" ? "Another brand already uses this domain." : error.message };
    // The reseller's own company shows its brand too.
    if (v.owner_company_id) await db.from("lb_companies").update({ brand_id: brandId }).eq("id", v.owner_company_id).is("brand_id", null);
    await db.from("lb_audit_log").insert({ company_id: v.owner_company_id ?? me.company_id, actor_id: me.id, action: id ? "platform.brand_update" : "platform.brand_create",
      entity: "brand", entity_id: brandId, data: { name: v.name, domain: v.domain, owner_company_id: v.owner_company_id } });
    revalidatePath("/", "layout");
    return { ok: id ? "Brand saved." : "Brand created." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Links a company to a brand (or back to plain Lead Box). */
export async function setCompanyBrand(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = z.object({ company_id: z.uuid(), brand_id: z.union([z.uuid(), z.literal("")]) }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: "Choose a brand." };
    const brand = p.data.brand_id || null;
    const { error } = await db.from("lb_companies").update({ brand_id: brand }).eq("id", p.data.company_id);
    if (error) return { error: error.message };
    await db.from("lb_audit_log").insert({ company_id: p.data.company_id, actor_id: me.id, action: "platform.company_brand", entity: "company", entity_id: p.data.company_id, data: { brand_id: brand } });
    revalidatePath("/", "layout");
    return { ok: brand ? "Brand applied. The company now sees the partner's logo and colours." : "Back to the Lead Box look." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

// ------------------------------------------------------------- reseller (partner's Company Admin)

async function requireReseller() {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) redirect("/dashboard");
  const sb = await createClient();
  const { data: brandId } = await sb.rpc("lb_my_reseller_brand");
  if (!brandId) redirect("/dashboard");
  if (!hasServiceRole()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing on the server.");
  return { me: profile, sb, brandId: brandId as string, db: createAdminClient() };
}

export async function saveMyBrand(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { sb, db, brandId } = await requireReseller();
    const p = lookSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const logo_url = await imageField(db, brandId, form, "logo");
    const icon_url = await imageField(db, brandId, form, "icon");
    // Domain, plan and "Powered by" stay with the platform; the RPC only touches the look.
    const payload: Record<string, unknown> = { ...p.data };
    if (logo_url !== undefined) payload.logo_url = logo_url ?? "";
    if (icon_url !== undefined) payload.icon_url = icon_url ?? "";
    for (const k of ["tagline", "support_email", "support_phone", "website"] as const) payload[k] = p.data[k] ?? "";
    const { error } = await sb.rpc("lb_save_my_brand", { p: payload });
    if (error) return { error: error.message };
    revalidatePath("/", "layout");
    return { ok: "Branding saved. Your clients see it on their next page load." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

const clientSchema = z.object({
  company: z.string().trim().min(2, "Enter the company name.").max(120),
  name: z.string().trim().min(2, "Enter the admin's name.").max(120),
  email: z.email("Enter a valid email.").trim().toLowerCase().max(200),
  phone: z.string().trim().max(20).optional(),
  password: z.string().max(200).optional(),
});

/** Partner adds a client company on a free trial of the brand's plan; it is linked to the partner's brand. */
export async function addClientCompany(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db, brandId } = await requireReseller();
    const p = clientSchema.safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const v = p.data;
    const phone = v.phone ? normalizePhone(v.phone) : null;
    if (v.phone && !phone) return { error: "Enter a valid mobile number." };
    const generated = !v.password;
    const password = v.password || randomBytes(9).toString("base64url");
    if (password.length < 8) return { error: "Password must be at least 8 characters." };

    const { data: brand } = await db.from("lb_brands").select("default_plan_id").eq("id", brandId).single();
    let planId = brand?.default_plan_id as string | null;
    if (!planId) {
      const { data: plan } = await db.from("lb_plans").select("id").eq("is_active", true).eq("is_public", true).order("sort").limit(1).maybeSingle();
      planId = plan?.id ?? null;
    }
    if (!planId) return { error: "No plan is set up for new clients yet. Ask Lead Box support." };

    const created = await db.auth.admin.createUser({ email: v.email, password, email_confirm: true, user_metadata: { full_name: v.name } });
    if (created.error || !created.data.user) {
      return { error: /already|registered|exists/i.test(created.error?.message ?? "") ? "A login with this email already exists." : created.error?.message ?? "Could not create the login." };
    }
    const uid = created.data.user.id;
    const { data: company, error } = await db.rpc("lb_platform_create_company", {
      p_actor: me.id, p_user: uid, p_company: v.company, p_full_name: v.name, p_email: v.email, p_phone: phone,
      p_plan: planId, p_status: "trial", p_days: null,
    });
    if (error || !company) {
      await db.auth.admin.deleteUser(uid);
      return { error: error?.message ?? "Could not create the company." };
    }
    await db.from("lb_companies").update({ brand_id: brandId }).eq("id", company as string);
    await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action: "brand.client_create", entity: "company", entity_id: company as string, data: { name: v.company, email: v.email } });
    revalidatePath("/admin/white-label");
    return { ok: `Client added on a free trial. Admin signs in with ${v.email}${generated ? ` and temporary password ${password} (shown once, share it securely)` : " and the password you set"}.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}
