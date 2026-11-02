"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { encryptSecret, errMsg, normalizePhone } from "@/lib/util";
import { demoBlocked } from "@/lib/demo";
import { appOrigin } from "@/lib/care-server";
import { ivrSettings, startIvrCall, testIvr, type IvrSettings } from "@/lib/ivr";

type FormState = { error?: string; ok?: string } | undefined;
const NOT_READY = "Cloud calling is not set up yet: run the IVR calling SQL once in Supabase.";
const fail = (e: unknown): FormState => { const m = errMsg(e); return { error: /lb_ivr|ivr_phone|provider_call_id|schema cache/i.test(m) ? NOT_READY : m }; };

async function admin() {
  const { profile } = await requireAdmin();
  const demo = await demoBlocked(profile.company_id);
  if (demo) throw new Error(demo);
  if (!hasServiceRole() || !process.env.LB_SECRETS_KEY) throw new Error("Server is not configured: SUPABASE_SERVICE_ROLE_KEY / LB_SECRETS_KEY missing.");
  return { me: profile, db: createAdminClient() };
}

export async function saveIvrSettings(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({
    provider: z.enum(["exotel", "knowlarity"]),
    enabled: z.string().optional().transform((v) => v === "on"),
    record: z.string().optional().transform((v) => v === "on"),
    account_sid: z.string().trim().max(100).optional().transform((v) => v || null),
    api_host: z.string().trim().max(100).optional().transform((v) => v || null),
    api_key: z.string().trim().min(3, "API key required").max(200),
    api_token: z.string().trim().max(500).optional().transform((v) => v || null),
    caller_id: z.string().trim().min(5, "Virtual number required").max(30),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const d = p.data;
  if (d.provider === "exotel" && !d.account_sid) return { error: "Exotel Account SID is required." };
  const caller = normalizePhone(d.caller_id, "IN") ?? (/^\+?\d{6,15}$/.test(d.caller_id) ? d.caller_id : null);
  if (!caller) return { error: "Enter the virtual number (ExoPhone / SR number)." };
  try {
    const { me, db } = await admin();
    const old = await ivrSettings(db, me.company_id);
    const tokenEnc = d.api_token ? encryptSecret(d.api_token) : old?.provider === d.provider ? old.api_token_enc : null;
    if (!tokenEnc) return { error: d.provider === "exotel" ? "API token is required." : "Authorization token is required." };
    const row = {
      company_id: me.company_id, provider: d.provider, enabled: d.enabled, record: d.record, account_sid: d.account_sid, api_host: d.api_host,
      api_key: d.api_key, api_token_enc: tokenEnc, caller_id: caller, updated_by: me.id, updated_at: new Date().toISOString(),
    };
    let msg = "Saved.";
    if (d.enabled) {
      try { msg = `Saved. ${await testIvr({ ...(old ?? { hook_token: "" }), ...row } as IvrSettings)}`; }
      catch (e) { return { error: `${(e as Error).message} Nothing was saved.` }; }
    }
    const { error } = await db.from("lb_ivr_settings").upsert(row, { onConflict: "company_id" });
    if (error) return fail(error);
    await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action: "integration.ivr.save", entity: "integration", entity_id: d.provider, data: { enabled: d.enabled } });
    revalidatePath("/admin/ivr");
    return { ok: msg };
  } catch (e) { return fail(e); }
}

/** The mobile number the provider rings for this user (admins set it for anyone). */
export async function setIvrPhone(userId: string, phone: string): Promise<FormState> {
  if (!z.uuid().safeParse(userId).success) return { error: "Invalid user" };
  const v = String(phone ?? "").trim();
  const e164 = v ? normalizePhone(v, "IN") : null;
  if (v && !e164) return { error: "Enter a valid mobile number." };
  try {
    const { me, db } = await admin();
    const { error } = await db.from("lb_profiles").update({ ivr_phone: e164 }).eq("id", userId).eq("company_id", me.company_id);
    if (error) return fail(error);
    revalidatePath("/admin/ivr");
    return { ok: "Saved." };
  } catch (e) { return fail(e); }
}

/** Click-to-call on a lead: rings my mobile, then the customer, from the company's virtual number. */
export async function ivrCallLead(leadId: string): Promise<FormState> {
  const { profile } = await requireProfile();
  if (!z.uuid().safeParse(leadId).success) return { error: "Invalid lead" };
  if (!hasServiceRole()) return { error: "Server not configured" };
  const sb = await createClient();
  const { data: lead } = await sb.from("lb_leads").select("id,customer:lb_customers(phone_e164)").eq("id", leadId).maybeSingle();
  const phone = (lead?.customer as unknown as { phone_e164: string } | null)?.phone_e164;
  if (!lead || !phone) return { error: "Lead not found" };
  const db = createAdminClient();
  const s = await ivrSettings(db, profile.company_id);
  if (!s?.enabled) return { error: "Cloud calling is off. An admin can turn it on in Integrations → Cloud calling (IVR)." };
  const { data: me } = await db.from("lb_profiles").select("ivr_phone,phone").eq("id", profile.id).maybeSingle();
  const agent = (me?.ivr_phone as string) || normalizePhone((me?.phone as string) ?? "", "IN");
  if (!agent) return { error: "Your mobile number for calling is not set. Ask your admin (Integrations → Cloud calling)." };
  const hook = `${await appOrigin()}/api/ivr/${s.provider}/${s.hook_token}`;
  const r = await startIvrCall(s, agent, phone, hook);
  if (r.error || !r.id) return { error: r.error ?? "Call failed" };
  const { error } = await db.rpc("lb_ivr_save_call", { p: {
    company_id: profile.company_id, provider: s.provider, call_id: r.id, user_id: profile.id, phone, direction: "outgoing",
    status: "initiated", duration: 0, started_at: new Date().toISOString(),
  } });
  if (error) console.error("ivr call row:", error.message);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/calls");
  return { ok: "Calling… your phone will ring first, then the customer." };
}

/** Is cloud calling on for my company (for the lead page button)? */
export async function ivrEnabled(): Promise<boolean> {
  const { profile } = await requireProfile();
  if (!hasServiceRole()) return false;
  const s = await ivrSettings(createAdminClient(), profile.company_id).catch(() => null);
  return Boolean(s?.enabled);
}
