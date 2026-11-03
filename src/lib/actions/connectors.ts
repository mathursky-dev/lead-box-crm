"use server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin, type Profile } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret, errMsg } from "@/lib/util";
import { checkWebhookUrl, hashKey, postWebhook, pullIndiamart, WEBHOOK_EVENTS, type Connector, type ConnectorKind } from "@/lib/lead-hooks";
import { widgetConfig } from "@/lib/widget";
import type { TestResult } from "./facebook";

type FormState = { error?: string; ok?: string } | undefined;
type Db = ReturnType<typeof createAdminClient>;

// Every write uses the service role and is pinned to the admin's active company.

const KINDS = ["google", "indiamart", "justdial", "widget", "webhook"] as const;
const uuidOpt = z.union([z.uuid(), z.literal("")]).optional().transform((v) => v || null);
const on = z.string().optional().transform((v) => v === "on");

async function audit(db: Db, me: Profile, action: string, entityId: string | null, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action, entity: "integration", entity_id: entityId, data });
}
async function owned(db: Db, cid: string, table: string, id: string | null) {
  if (!id) return true;
  return Boolean((await db.from(table).select("id").eq("id", id).eq("company_id", cid).maybeSingle()).data);
}
const done = (msg: string): FormState => { revalidatePath("/admin", "layout"); return { ok: msg }; };
const ready = () => (hasServiceRole() ? null : "Server is not configured (service role key).");

// ------------------------------------------------------------ connectors
export async function saveConnector(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (ready()) return { error: ready()! };
  const p = z.object({
    id: uuidOpt, kind: z.enum(KINDS), name: z.string().trim().min(1, "Give it a name").max(120),
    source_id: uuidOpt, product_id: uuidOpt, department_id: uuidOpt, tag_id: uuidOpt, is_active: on,
    secret: z.string().trim().max(200).optional(),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, kind, secret, ...v } = p.data;
  const db = createAdminClient();
  for (const [t, ref] of [["lb_sources", v.source_id], ["lb_products", v.product_id], ["lb_departments", v.department_id], ["lb_tags", v.tag_id]] as const) {
    if (!(await owned(db, me.company_id, t, ref))) return { error: "Pick a valid option." };
  }
  const row: Record<string, unknown> = { ...v, updated_at: new Date().toISOString() };
  if (kind === "widget") {
    const g = (k: string) => String(form.get(k) ?? "");
    const cfg = widgetConfig({ wa_number: g("wa_number"), title: g("title"), subtitle: g("subtitle"), greeting: g("greeting"), button_text: g("button_text"),
      message: g("message"), thank_you: g("thank_you"), color: g("color"), position: g("position"), ask_details: form.get("ask_details") === "on" });
    if (cfg.wa_number.length < 8) return { error: "Enter the WhatsApp number with country code, e.g. 919876543210" };
    row.config = cfg;
  }
  try {
    if (kind === "indiamart" && secret) {
      if (!/^[A-Za-z0-9+/=_-]{10,200}$/.test(secret)) return { error: "That does not look like an IndiaMART CRM key." };
      row.secret_enc = encryptSecret(secret);
      row.last_sync_at = null;
    }
    if (id) {
      const { data: cur } = await db.from("lb_lead_connectors").select("kind").eq("id", id).eq("company_id", me.company_id).maybeSingle();
      if (!cur || cur.kind !== kind) return { error: "Connection not found" };
      const { error } = await db.from("lb_lead_connectors").update(row).eq("id", id).eq("company_id", me.company_id);
      if (error) return { error: errMsg(error) };
    } else {
      if (kind === "google") row.secret_enc = encryptSecret(randomBytes(12).toString("hex"));
      const { error } = await db.from("lb_lead_connectors").insert({ ...row, kind, company_id: me.company_id, token: randomBytes(20).toString("hex"), created_by: me.id });
      if (error) return { error: errMsg(error) };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  await audit(db, me, id ? "connector.update" : "connector.create", id, { kind, name: v.name });
  return done("Saved.");
}

export async function deleteConnector(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data, error } = await db.from("lb_lead_connectors").delete().eq("id", id).eq("company_id", me.company_id).select("kind,name").maybeSingle();
  if (error) return { error: errMsg(error) };
  if (!data) return { error: "Connection not found" };
  await audit(db, me, "connector.delete", id, data);
  return done("Deleted. Leads already received stay in the CRM.");
}

export async function regenerateConnectorToken(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data } = await db.from("lb_lead_connectors").update({ token: randomBytes(20).toString("hex"), updated_at: new Date().toISOString() })
    .eq("id", id).eq("company_id", me.company_id).select("id").maybeSingle();
  if (!data) return { error: "Connection not found" };
  await audit(db, me, "connector.new_url", id);
  return done("New URL created. Update it in the other software; the old URL stops working now.");
}

/** Test one connection: IndiaMART with a CRM key does a real pull; others report what was received. */
export async function testConnector(id: string): Promise<TestResult> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data: c } = await db.from("lb_lead_connectors").select("*").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!c) return { error: "Connection not found" };
  const checks: [string, boolean, string][] = [["Active", c.is_active, c.is_active ? "Receiving leads" : "Paused: turn it on to receive leads"]];
  if (c.kind === "indiamart" && c.secret_enc) {
    const r = await pullIndiamart(c as Connector);
    checks.push(["IndiaMART CRM key", r.ok, r.message]);
  }
  if (c.kind === "google") {
    let ok = false;
    try { ok = Boolean(c.secret_enc && decryptSecret(c.secret_enc)); } catch { /* unreadable */ }
    checks.push(["Webhook key", ok, ok ? "Saved" : "Missing: delete and add this connection again"]);
  }
  checks.push(["Last lead", Boolean(c.last_lead_at), c.last_lead_at
    ? `${new Date(c.last_lead_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · ${c.leads_count} new, ${c.duplicate_count} repeat`
    : "Nothing received yet. Send a test lead from the other side."]);
  if (c.last_error) checks.push(["Last problem", false, c.last_error]);
  return { checks };
}

/** Quick Setup → Test for a whole kind (all connections of that kind). */
export async function testConnectorKind(kind: ConnectorKind): Promise<TestResult> {
  const { profile: me } = await requireAdmin();
  if (ready()) return { error: ready()! };
  const { data } = await createAdminClient().from("lb_lead_connectors").select("id,name").eq("company_id", me.company_id).eq("kind", kind).order("created_at");
  if (!data?.length) return { error: "Not set up yet. Click Set to add it." };
  const all: [string, boolean, string][] = [];
  for (const c of data.slice(0, 3)) {
    const r = await testConnector(c.id);
    for (const [l, ok, d] of r.checks ?? []) all.push([data.length > 1 ? `${c.name}: ${l}` : l, ok, d]);
  }
  return { checks: all };
}

// --------------------------------------------------------------- API keys
export async function createApiKey(name: string, scopes: string[], expiresDays = 0): Promise<{ error?: string; key?: string }> {
  const { profile: me } = await requireAdmin();
  if (ready()) return { error: ready()! };
  const p = z.object({ name: z.string().trim().min(1, "Give the key a name").max(80), scopes: z.array(z.enum(["leads.read", "leads.write", "leads.update"])).min(1, "Pick at least one permission"),
    expiresDays: z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(180), z.literal(365)]) })
    .safeParse({ name, scopes, expiresDays });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const db = createAdminClient();
  const { count } = await db.from("lb_api_keys").select("id", { count: "exact", head: true }).eq("company_id", me.company_id).is("revoked_at", null);
  if ((count ?? 0) >= 20) return { error: "Max 20 active keys. Revoke an old one first." };
  const key = `lbk_${randomBytes(20).toString("hex")}`;
  const expires_at = p.data.expiresDays ? new Date(Date.now() + p.data.expiresDays * 864e5).toISOString() : null;
  const { data, error } = await db.from("lb_api_keys").insert({ company_id: me.company_id, name: p.data.name, prefix: key.slice(0, 12), key_hash: hashKey(key), scopes: p.data.scopes, created_by: me.id, ...(expires_at ? { expires_at } : {}) })
    .select("id").single();
  if (error) return { error: errMsg(error) };
  await audit(db, me, "api_key.create", data.id, { name: p.data.name, scopes: p.data.scopes, expires_at });
  revalidatePath("/admin/api");
  return { key };
}

export async function revokeApiKey(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data } = await db.from("lb_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("company_id", me.company_id).is("revoked_at", null).select("name").maybeSingle();
  if (!data) return { error: "Key not found" };
  await audit(db, me, "api_key.revoke", id, data);
  revalidatePath("/admin/api");
  return { ok: "Key revoked. Apps using it stop working now." };
}

// -------------------------------------------------------------- webhooks
export async function saveWebhook(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (ready()) return { error: ready()! };
  const p = z.object({ id: uuidOpt, name: z.string().trim().min(1).max(80), url: z.string().trim().max(1000), is_active: on })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const events = form.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) return { error: "Pick at least one event." };
  const bad = await checkWebhookUrl(p.data.url);
  if (bad) return { error: bad };
  const { id, ...v } = p.data;
  const db = createAdminClient();
  try {
    if (id) {
      const { data, error } = await db.from("lb_webhooks").update({ ...v, events, ...(v.is_active ? { failures: 0 } : {}) }).eq("id", id).eq("company_id", me.company_id).select("id").maybeSingle();
      if (error) return { error: errMsg(error) };
      if (!data) return { error: "Webhook not found" };
    } else {
      const { count } = await db.from("lb_webhooks").select("id", { count: "exact", head: true }).eq("company_id", me.company_id);
      if ((count ?? 0) >= 10) return { error: "Max 10 webhooks per company." };
      const { error } = await db.from("lb_webhooks").insert({ ...v, events, company_id: me.company_id, created_by: me.id, secret_enc: encryptSecret(`whsec_${randomBytes(24).toString("hex")}`) });
      if (error) return { error: errMsg(error) };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  await audit(db, me, id ? "webhook.update" : "webhook.create", id, { url: v.url, events });
  revalidatePath("/admin/api");
  return { ok: "Saved." };
}

export async function deleteWebhook(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data } = await db.from("lb_webhooks").delete().eq("id", id).eq("company_id", me.company_id).select("url").maybeSingle();
  if (!data) return { error: "Webhook not found" };
  await audit(db, me, "webhook.delete", id, data);
  revalidatePath("/admin/api");
  return { ok: "Deleted." };
}

export async function revealWebhookSecret(id: string): Promise<{ error?: string; secret?: string }> {
  const { profile: me } = await requireAdmin();
  const { data } = await createAdminClient().from("lb_webhooks").select("secret_enc").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!data) return { error: "Webhook not found" };
  try { return { secret: decryptSecret(data.secret_enc) }; } catch { return { error: "Secret could not be read" }; }
}

/** Sends a sample lead.created call right now (not queued) and reports the HTTP result. */
export async function testWebhook(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const db = createAdminClient();
  const { data: w } = await db.from("lb_webhooks").select("url,secret_enc").eq("id", id).eq("company_id", me.company_id).maybeSingle();
  if (!w) return { error: "Webhook not found" };
  let secret: string;
  try { secret = decryptSecret(w.secret_enc); } catch { return { error: "Secret could not be read" }; }
  const now = new Date().toISOString();
  const r = await postWebhook(w.url, secret, "lead.created", {
    event: "lead.created", test: true, sent_at: now,
    lead: { id: "00000000-0000-0000-0000-000000000000", lead_no: 0, name: "Test Lead", phone: "+919999999999", email: "test@example.com", location: "Jaipur",
      source: "Website", product: null, status: "New", status_category: "new", owner: null, owner_email: null, priority: "normal", expected_value: null, notes: "Sample from Lead Box", custom: {}, created_at: now, updated_at: now },
  });
  await db.from("lb_webhooks").update({ last_status: r.code, last_error: r.error, last_sent_at: now }).eq("id", id);
  revalidatePath("/admin/api");
  return r.ok ? { ok: `Test sent: HTTP ${r.code}` } : { error: `Test failed: ${r.error ?? `HTTP ${r.code}`}` };
}
