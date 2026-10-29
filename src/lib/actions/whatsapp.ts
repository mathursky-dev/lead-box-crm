"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/util";
import { phoneInfo, subscribeApp, listTemplates, numberCredentials, markNumberError, graph, ownerWaba } from "@/lib/whatsapp";

type FormState = { error?: string; ok?: string } | undefined;
const uuidOpt = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);

async function audit(companyId: string, actorId: string, action: string, entityId: string, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity: "wa_number", entity_id: entityId, data });
}

const WRONG_WABA = "This access token can't see a WhatsApp Business Account that owns this phone number. In Business Settings → System users, assign the right WhatsApp account to the system user (Full control), generate a new token, and paste it here.";

/** Make sure the stored WABA ID really owns the number; fixes it in place when the token reveals the right one. */
async function checkWaba(c: { id: string; token: string; phone_number_id: string; waba_id: string }) {
  const waba = await ownerWaba(c.token, c.phone_number_id, c.waba_id);
  if (!waba) return { error: WRONG_WABA };
  if (waba !== c.waba_id) await createAdminClient().from("lb_wa_numbers").update({ waba_id: waba }).eq("id", c.id);
  return { waba, fixed: waba !== c.waba_id ? `WABA ID corrected to ${waba}. ` : "" };
}

const schema = z.object({
  id: uuidOpt,
  label: z.string().trim().min(1).max(80),
  phone_number_id: z.string().trim().regex(/^\d{6,30}$/, "Phone number ID must be digits"),
  waba_id: z.string().trim().regex(/^\d{6,30}$/, "WABA ID must be digits"),
  access_token: z.string().trim().optional(),
  branch_id: uuidOpt, department_id: uuidOpt, team_id: uuidOpt, product_id: uuidOpt,
  is_active: z.string().optional().transform((v) => v === "on"),
});

/** Create/update a business number. The token is verified against Graph, then encrypted at rest. */
export async function saveNumber(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!hasServiceRole()) return { error: "Server is not configured (SUPABASE_SERVICE_ROLE_KEY)." };
  const p = schema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, access_token, ...v } = p.data;
  const db = createAdminClient();
  for (const [t, ref] of [["lb_branches", v.branch_id], ["lb_departments", v.department_id], ["lb_teams", v.team_id], ["lb_products", v.product_id]] as const) {
    if (ref && !(await db.from(t).select("id").eq("id", ref).eq("company_id", me.company_id).maybeSingle()).data) return { error: "Invalid selection" };
  }
  if (id) {
    const { data: cur } = await db.from("lb_wa_numbers").select("company_id").eq("id", id).single();
    if (!cur || (cur.company_id !== me.company_id && me.role !== "super_admin")) return { error: "Number not found" };
  } else if (!access_token) return { error: "Access token is required." };

  let check: Awaited<ReturnType<typeof phoneInfo>> | null = null;
  if (access_token) {
    check = await phoneInfo(access_token, v.phone_number_id);
    if (!check.ok) return { error: `Meta rejected these credentials: ${check.message}` };
    const waba = await ownerWaba(access_token, v.phone_number_id, v.waba_id);
    if (!waba) return { error: WRONG_WABA };
    v.waba_id = waba;
  }
  const row = {
    ...v, ...(check?.ok ? { display_phone: check.data.display_phone_number, verified_name: check.data.verified_name, quality_rating: check.data.quality_rating ?? null,
      status: "connected", last_error: null, last_checked_at: new Date().toISOString() } : {}),
  };
  let numberId = id;
  if (id) {
    const { error } = await db.from("lb_wa_numbers").update(row).eq("id", id);
    if (error) return { error: error.code === "23505" ? "That phone number ID is already connected." : error.message };
  } else {
    const { data, error } = await db.from("lb_wa_numbers").insert({ ...row, company_id: me.company_id }).select("id").single();
    if (error) return { error: error.code === "23505" ? "That phone number ID is already connected." : error.message };
    numberId = data.id;
  }
  if (access_token) {
    const { error } = await db.from("lb_wa_number_secrets").upsert({ number_id: numberId, access_token: encryptSecret(access_token), updated_at: new Date().toISOString() });
    if (error) return { error: error.message };
  }
  // Team/user access to this number.
  const teams = form.getAll("teams").map(String).filter(Boolean);
  const users = form.getAll("users").map(String).filter(Boolean);
  await db.from("lb_wa_number_teams").delete().eq("number_id", numberId!);
  await db.from("lb_wa_number_users").delete().eq("number_id", numberId!);
  const okTeams = teams.length ? (await db.from("lb_teams").select("id").in("id", teams).eq("company_id", me.company_id)).data ?? [] : [];
  const okUsers = users.length ? (await db.from("lb_profiles").select("id").in("id", users).eq("company_id", me.company_id)).data ?? [] : [];
  if (okTeams.length) await db.from("lb_wa_number_teams").insert(okTeams.map((t) => ({ number_id: numberId, team_id: t.id })));
  if (okUsers.length) await db.from("lb_wa_number_users").insert(okUsers.map((u) => ({ number_id: numberId, user_id: u.id })));
  await audit(me.company_id, me.id, id ? "wa_number.update" : "wa_number.create", numberId!, { ...v, token_changed: Boolean(access_token), teams, users });
  revalidatePath("/admin/numbers");
  return { ok: id ? "Saved." : "Number connected. Now subscribe the webhook and sync templates." };
}

export async function testNumber(numberId: string): Promise<FormState> {
  await requireAdmin();
  const c = await numberCredentials(numberId);
  if (!c) return { error: "No credentials stored for this number." };
  if (c.provider === "qr") return { error: "QR-scan numbers are checked from Admin → Integrations." };
  const r = await phoneInfo(c.token, c.phone_number_id);
  if (!r.ok) { await markNumberError(numberId, r.message); revalidatePath("/admin/numbers"); return { error: r.message }; }
  await createAdminClient().from("lb_wa_numbers").update({
    status: "connected", last_error: null, last_checked_at: new Date().toISOString(),
    display_phone: r.data.display_phone_number, verified_name: r.data.verified_name, quality_rating: r.data.quality_rating ?? null,
  }).eq("id", numberId);
  revalidatePath("/admin/numbers");
  return { ok: `Connected: ${r.data.verified_name} (${r.data.display_phone_number})` };
}

export async function subscribeWebhook(numberId: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const c = await numberCredentials(numberId);
  if (!c) return { error: "No credentials stored for this number." };
  if (c.provider === "qr") return { error: "QR-scan numbers don't use Meta webhooks." };
  const w = await checkWaba(c);
  if ("error" in w) return { error: w.error };
  const r = await subscribeApp(c.token, w.waba);
  if (!r.ok) return { error: r.message };
  await audit(me.company_id, me.id, "wa_number.subscribe", numberId, { waba_id: w.waba });
  revalidatePath("/admin/numbers");
  return { ok: `${w.fixed}App subscribed to this WhatsApp Business Account's webhooks.` };
}

export async function syncTemplates(numberId: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const c = await numberCredentials(numberId);
  if (!c) return { error: "No credentials stored for this number." };
  if (c.provider === "qr") return { error: "Templates need the official API; QR-scan numbers send normal messages only." };
  const w = await checkWaba(c);
  if ("error" in w) return { error: w.error };
  c.waba_id = w.waba;
  const r = await listTemplates(c.token, c.waba_id);
  if (!r.ok) return { error: r.message };
  const db = createAdminClient();
  const rows = r.data.map((t) => ({
    company_id: c.company_id, waba_id: c.waba_id, wa_template_id: String(t.id), name: String(t.name), language: String(t.language),
    category: t.category ? String(t.category) : null, status: String(t.status), components: t.components ?? [], synced_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await db.from("lb_wa_templates").upsert(rows, { onConflict: "company_id,waba_id,name,language" });
    if (error) return { error: error.message };
  }
  // Templates deleted on Meta's side are marked so they can't be sent.
  const keep = new Set(rows.map((x) => `${x.name}|${x.language}`));
  const { data: existing } = await db.from("lb_wa_templates").select("id,name,language").eq("company_id", c.company_id).eq("waba_id", c.waba_id);
  const gone = (existing ?? []).filter((e) => !keep.has(`${e.name}|${e.language}`)).map((e) => e.id);
  if (gone.length) await db.from("lb_wa_templates").update({ status: "DELETED" }).in("id", gone);
  await audit(me.company_id, me.id, "wa_templates.sync", numberId, { count: rows.length });
  revalidatePath("/admin/templates");
  return { ok: `Synced ${rows.length} template(s).` };
}

const vars = (t: string) => [...new Set(t.match(/\{\{(\d+)\}\}/g) ?? [])].map((v) => Number(v.slice(2, -2))).sort((a, b) => a - b);
const tplSchema = z.object({
  number_id: z.uuid(),
  name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Name: lowercase letters, numbers and underscores only"),
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Language code like en, en_US or hi"),
  category: z.enum(["MARKETING", "UTILITY"]),
  header: z.string().trim().max(60).optional(),
  body: z.string().trim().min(1).max(1024),
  footer: z.string().trim().max(60).optional(),
  examples: z.string().optional(),
  header_example: z.string().trim().max(60).optional(),
  quick_replies: z.string().optional(),
  url_text: z.string().trim().max(25).optional(),
  url: z.union([z.url(), z.literal("")]).optional(),
});

/** Submit a new template to Meta for review (ported from wacrm). It appears as PENDING until Meta approves it. */
export async function createTemplate(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const p = tplSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  const c = await numberCredentials(v.number_id);
  if (!c || c.company_id !== me.company_id) return { error: "No credentials stored for this number." };
  if (c.provider === "qr") return { error: "Templates need the official API; pick a Meta-connected number." };
  const bodyVars = vars(v.body);
  if (bodyVars.some((n, i) => n !== i + 1)) return { error: "Body variables must be numbered {{1}}, {{2}}, … without gaps." };
  const examples = (v.examples ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (examples.length < bodyVars.length) return { error: `Give one sample value per line for each body variable (${bodyVars.length} needed).` };
  const headerVars = v.header ? vars(v.header) : [];
  if (headerVars.length > 1 || (headerVars.length === 1 && headerVars[0] !== 1)) return { error: "The header may contain only {{1}}." };
  if (headerVars.length && !v.header_example) return { error: "Give a sample value for the header variable." };
  const qr = (v.quick_replies ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (qr.length > 3 || qr.some((x) => x.length > 25)) return { error: "Up to 3 quick-reply buttons, 25 characters each." };
  if (!!v.url_text !== !!v.url) return { error: "A link button needs both text and URL." };

  const components: Record<string, unknown>[] = [];
  if (v.header) components.push({ type: "HEADER", format: "TEXT", text: v.header, ...(headerVars.length ? { example: { header_text: [v.header_example] } } : {}) });
  components.push({ type: "BODY", text: v.body, ...(bodyVars.length ? { example: { body_text: [examples.slice(0, bodyVars.length)] } } : {}) });
  if (v.footer) components.push({ type: "FOOTER", text: v.footer });
  const buttons = [...qr.map((text) => ({ type: "QUICK_REPLY", text })), ...(v.url ? [{ type: "URL", text: v.url_text, url: v.url }] : [])];
  if (buttons.length) components.push({ type: "BUTTONS", buttons });

  const r = await graph<{ id: string; status: string; category?: string }>(c.token, `${c.waba_id}/message_templates`, {
    method: "POST", body: JSON.stringify({ name: v.name, language: v.language, category: v.category, components }),
  });
  if (!r.ok) return { error: r.message };
  const { error } = await createAdminClient().from("lb_wa_templates").upsert({
    company_id: c.company_id, waba_id: c.waba_id, wa_template_id: String(r.data.id), name: v.name, language: v.language,
    category: r.data.category ?? v.category, status: r.data.status ?? "PENDING", components, synced_at: new Date().toISOString(),
  }, { onConflict: "company_id,waba_id,name,language" });
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "wa_template.create", v.number_id, { name: v.name, language: v.language });
  revalidatePath("/admin/templates");
  return { ok: `Submitted “${v.name}” — status ${r.data.status ?? "PENDING"}. Meta usually reviews within minutes to hours.` };
}
