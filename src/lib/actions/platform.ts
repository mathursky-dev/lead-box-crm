"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { normalizePhone, errMsg } from "@/lib/util";
import { FEATURES } from "@/lib/plans";
import { UPI_ID_RE } from "@/lib/upi";

type FormState = { error?: string; ok?: string } | undefined;

/** Platform owner only. Every write below uses the service role, so this check is the gate. */
async function requireSuper() {
  const { profile } = await requireProfile();
  if (profile.role !== "super_admin") redirect("/dashboard");
  if (!hasServiceRole()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing on the server.");
  return { me: profile, db: createAdminClient() };
}

async function audit(db: ReturnType<typeof createAdminClient>, actor: string, company: string, action: string, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: company, actor_id: actor, action, entity: "company", entity_id: company, data });
}

const done = (ok: string, company?: string): FormState => {
  revalidatePath("/platform", "layout");
  if (company) revalidatePath(`/platform/companies/${company}`);
  return { ok };
};

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const optInt = (min: number) => z.string().trim().optional().transform((v) => (v ? Math.max(min, parseInt(v, 10) || min) : null));
const companyId = z.object({ company_id: z.uuid() });

// ------------------------------------------------------------- companies

const createSchema = z.object({
  company: z.string().trim().min(2, "Enter the company name.").max(120),
  name: z.string().trim().min(2, "Enter the admin's name.").max(120),
  email: z.email("Enter a valid email.").trim().toLowerCase().max(200),
  phone: z.string().trim().max(20).optional(),
  password: z.string().max(200).optional(),
  plan_id: z.uuid("Choose a plan."),
  status: z.enum(["trial", "paid", "internal"]),
  days: optInt(1),
});

/** Creates a company with its first Company Admin login, without a self-serve trial claim. */
export async function createCompany(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = createSchema.safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const v = p.data;
    const phone = v.phone ? normalizePhone(v.phone) : null;
    if (v.phone && !phone) return { error: "Enter a valid mobile number." };
    const generated = !v.password;
    const password = v.password || randomBytes(9).toString("base64url");
    if (password.length < 8) return { error: "Password must be at least 8 characters." };

    const created = await db.auth.admin.createUser({ email: v.email, password, email_confirm: true, user_metadata: { full_name: v.name } });
    if (created.error || !created.data.user) {
      return { error: /already|registered|exists/i.test(created.error?.message ?? "") ? "A login with this email already exists." : created.error?.message ?? "Could not create the login." };
    }
    const uid = created.data.user.id;
    const { data: company, error } = await db.rpc("lb_platform_create_company", {
      p_actor: me.id, p_user: uid, p_company: v.company, p_full_name: v.name, p_email: v.email, p_phone: phone,
      p_plan: v.plan_id, p_status: v.status, p_days: v.days,
    });
    if (error) {
      await db.auth.admin.deleteUser(uid); // don't leave a login without a company
      return { error: error.message };
    }
    done("", company as string);
    return { ok: `Company created. Admin signs in with ${v.email}${generated ? ` and temporary password ${password} (shown once, share it securely)` : " and the password you set"}.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function setCompanyPlan(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = companyId.extend({ plan_id: z.uuid() }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: "Choose a plan." };
    const { error } = await db.from("lb_billing").update({ plan_id: p.data.plan_id, updated_at: new Date().toISOString() }).eq("company_id", p.data.company_id);
    if (error) return { error: error.message };
    await audit(db, me.id, p.data.company_id, "platform.plan_change", { plan_id: p.data.plan_id });
    return done("Plan changed. New limits apply from now.", p.data.company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Sets the trial to end N days from now (0 ends it now). */
export async function setTrial(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = companyId.extend({ days: int(0, 365) }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: "Enter 0–365 days." };
    const ends = new Date(Date.now() + p.data.days * 86400000).toISOString();
    const { error } = await db.rpc("lb_platform_set_trial", { p_actor: me.id, p_company: p.data.company_id, p_ends_at: ends });
    if (error) return { error: error.message };
    return done(p.data.days ? `Trial now ends in ${p.data.days} day${p.data.days > 1 ? "s" : ""}.` : "Trial ended.", p.data.company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Cash / UPI / bank transfer received outside Razorpay: records it and extends paid access. */
export async function recordManualPayment(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = companyId.extend({
      amount: z.coerce.number().min(0).max(10_000_000),
      days: int(1, 3660),
      seats: int(1, 10000).default(1),
      method: z.string().trim().min(1).max(40),
      reference: z.string().trim().min(2, "Enter a payment reference (UTR, receipt no.).").max(120),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const v = p.data;
    const { error } = await db.rpc("lb_record_payment", {
      p_id: `manual_${randomUUID()}`, p_company: v.company_id, p_provider: `manual:${v.method}`,
      p_amount_paise: Math.round(v.amount * 100), p_currency: "INR", p_seats: v.seats, p_days: v.days,
      p_raw: { reference: v.reference, by: me.id },
    });
    if (error) return { error: error.message };
    await audit(db, me.id, v.company_id, "platform.payment_manual", { amount: v.amount, days: v.days, method: v.method, reference: v.reference });
    return done(`Payment recorded. Access extended by ${v.days} days.`, v.company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function setSuspended(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = companyId.extend({ suspend: z.enum(["1", "0"]), reason: z.string().trim().max(300).optional() }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: "Invalid request." };
    const { company_id, reason } = p.data;
    const suspend = p.data.suspend === "1";
    if (company_id === me.company_id && suspend) return { error: "You cannot suspend your own company." };
    const { error } = await db.from("lb_billing").update({
      suspended_at: suspend ? new Date().toISOString() : null, suspended_reason: suspend ? reason || null : null, updated_at: new Date().toISOString(),
    }).eq("company_id", company_id);
    if (error) return { error: error.message };
    await db.from("lb_companies").update({ is_active: !suspend }).eq("id", company_id);
    await audit(db, me.id, company_id, suspend ? "platform.suspend" : "platform.activate", { reason });
    return done(suspend ? "Company suspended. Its users can no longer use the CRM; data is kept." : "Company activated.", company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Makes a company free forever (internal) or puts it back on normal billing. */
export async function setInternal(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = companyId.extend({ internal: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: "Invalid request." };
    const { data: b } = await db.from("lb_billing").select("paid_until").eq("company_id", p.data.company_id).single();
    const plan = p.data.internal === "1" ? "internal" : b?.paid_until ? "paid" : "trial";
    const { error } = await db.from("lb_billing").update({ plan, updated_at: new Date().toISOString() }).eq("company_id", p.data.company_id);
    if (error) return { error: error.message };
    await audit(db, me.id, p.data.company_id, "platform.internal", { plan });
    return done(plan === "internal" ? "Company now has free unlimited access." : "Company is back on normal billing.", p.data.company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function walletCredit(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = companyId.extend({
      amount: z.coerce.number().positive("Enter an amount.").max(10_000_000),
      reference: z.string().trim().min(2, "Enter a payment reference.").max(120),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const { data, error } = await db.rpc("lb_wallet_add", { p_company: p.data.company_id, p_amount: p.data.amount, p_reference: p.data.reference, p_request_key: randomUUID() });
    if (error) return { error: error.message };
    await audit(db, me.id, p.data.company_id, "wallet.manual_credit", { amount: p.data.amount, reference: p.data.reference });
    return done(`Wallet credited. New balance ₹${Number(data).toLocaleString("en-IN")}.`, p.data.company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function saveNotes(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { db } = await requireSuper();
    const p = companyId.extend({ notes: z.string().max(4000) }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: "Notes are too long." };
    const { error } = await db.from("lb_billing").update({ notes: p.data.notes || null }).eq("company_id", p.data.company_id);
    if (error) return { error: error.message };
    return done("Notes saved.", p.data.company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Sets a new password for any user of a tenant (e.g. a locked-out company admin). */
export async function setTenantPassword(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = companyId.extend({ user_id: z.uuid(), password: z.string().min(8, "Password must be at least 8 characters.").max(200) }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const { data: u } = await db.from("lb_profiles").select("id").eq("id", p.data.user_id).eq("company_id", p.data.company_id).maybeSingle();
    if (!u) return { error: "User not found in this company." };
    const { error } = await db.auth.admin.updateUserById(p.data.user_id, { password: p.data.password });
    if (error) return { error: error.message };
    await audit(db, me.id, p.data.company_id, "platform.user_password", { user_id: p.data.user_id });
    return done("Password updated.", p.data.company_id);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

// ------------------------------------------------------------- plans

const planSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, "Code: 2–40 lowercase letters, digits or -"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  price_inr: int(0, 10_000_000),
  per_user: z.string().optional().transform((v) => v === "on"),
  period_days: int(1, 3660),
  trial_days: int(0, 90),
  max_users: optInt(1),
  max_numbers: optInt(0),
  max_leads_month: optInt(1),
  is_public: z.string().optional().transform((v) => v === "on"),
  is_active: z.string().optional().transform((v) => v === "on"),
  sort: z.coerce.number().int().default(0),
});

export async function savePlan(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { db } = await requireSuper();
    const p = planSchema.safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const { id, ...v } = p.data;
    const row = { ...v, features: Object.keys(FEATURES).filter((k) => form.get(`f_${k}`) === "on"), updated_at: new Date().toISOString() };
    const { error } = id ? await db.from("lb_plans").update(row).eq("id", id) : await db.from("lb_plans").insert(row);
    if (error) return { error: error.code === "23505" ? "A plan with this code already exists." : error.message };
    revalidatePath("/platform", "layout");
    return { ok: id ? "Plan saved." : "Plan created." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

// ------------------------------------------------------------- wallet UPI

export async function reviewTopup(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = z.object({
      id: z.uuid(), approve: z.enum(["1", "0"]), note: z.string().trim().max(300).optional(),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: "Invalid request." };
    if (p.data.approve === "0" && !p.data.note) return { error: "Write why it is rejected (the company sees this)." };
    const { data, error } = await db.rpc("lb_wallet_review_topup", { p_actor: me.id, p_id: p.data.id, p_approve: p.data.approve === "1", p_note: p.data.note || null });
    if (error) return { error: error.message };
    revalidatePath("/platform/wallet");
    return done(p.data.approve === "1" ? `Approved. Wallet balance is now ₹${Number(data).toLocaleString("en-IN")}.` : "Rejected.");
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function saveUpiSettings(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await requireSuper();
    const p = z.object({
      upi_id: z.string().trim().regex(UPI_ID_RE, "Enter a UPI ID like name@okhdfcbank."),
      upi_name: z.string().trim().min(1, "Enter the payee name.").max(80),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const { error } = await db.from("lb_platform_settings").upsert({ id: true, ...p.data, updated_at: new Date().toISOString() });
    if (error) return { error: error.message };
    await audit(db, me.id, me.company_id, "platform.upi_settings", p.data);
    revalidatePath("/platform/wallet");
    revalidatePath("/wallet");
    return { ok: "UPI details saved." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}
