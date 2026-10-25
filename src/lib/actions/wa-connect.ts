"use server";
import { revalidatePath } from "next/cache";
import { randomBytes, randomInt } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/util";
import { fbApp } from "@/lib/facebook";
import { graph, phoneInfo, subscribeApp, gatewayConfigured, gatewayBase } from "@/lib/whatsapp";
import { syncTemplates } from "./whatsapp";

type FormState = { error?: string; ok?: string } | undefined;

async function audit(companyId: string, actorId: string, action: string, entityId: string, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity: "wa_number", entity_id: entityId, data });
}

/** Meta "Facebook Login for Business" configuration id used by Embedded Signup. */
export async function saveSignupConfig(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!hasServiceRole()) return { error: "Server is not configured (SUPABASE_SERVICE_ROLE_KEY)." };
  const v = String(form.get("config_id") ?? "").trim();
  if (v && !/^\d{6,30}$/.test(v)) return { error: "Configuration ID must be digits." };
  const { error } = await createAdminClient().from("lb_integrations")
    .upsert({ company_id: me.company_id, wa_es_config_id: v || null, updated_by: me.id, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath("/admin/integrations");
  return { ok: "Saved." };
}

type Phone = { id: string; display_phone_number: string; verified_name: string; quality_rating?: string };

/**
 * Embedded Signup finish: the browser hands us the one-time code (+ WABA / phone ids from the
 * WA_EMBEDDED_SIGNUP message). Exchange it for a business token, register the number on the
 * Cloud API, subscribe our app to the WABA, and store it like a manually added number.
 */
export async function completeEmbeddedSignup(input: { code: string; wabaId?: string; phoneNumberId?: string }): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  if (!hasServiceRole() || !process.env.LB_SECRETS_KEY) return { error: "Server is not configured (service key / LB_SECRETS_KEY)." };
  const app = await fbApp(me.company_id).catch(() => null);
  if (!app) return { error: "Save the Meta App ID and App Secret below first." };
  const appToken = `${app.appId}|${app.secret}`;

  const t = await graph<{ access_token: string }>(appToken, `oauth/access_token?${new URLSearchParams({ client_id: app.appId, client_secret: app.secret, code: input.code })}`);
  if (!t.ok) return { error: `Facebook token exchange failed: ${t.message}` };
  const token = t.data.access_token;

  // The popup message can be lost (blocked popups, old browsers): fall back to the token's granted WABA.
  let wabaId = /^\d+$/.test(input.wabaId ?? "") ? input.wabaId! : null;
  if (!wabaId) {
    const dbg = await graph<{ data: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(appToken, `debug_token?input_token=${encodeURIComponent(token)}`);
    wabaId = dbg.ok ? dbg.data.data.granular_scopes?.find((s) => s.scope === "whatsapp_business_management")?.target_ids?.[0] ?? null : null;
  }
  if (!wabaId) return { error: "Facebook did not share a WhatsApp Business Account. Please try again and finish all steps." };

  let phone: Phone | null = null;
  if (/^\d+$/.test(input.phoneNumberId ?? "")) {
    const r = await phoneInfo(token, input.phoneNumberId!);
    if (r.ok) phone = { id: input.phoneNumberId!, ...r.data };
  }
  if (!phone) {
    const r = await graph<{ data: Phone[] }>(token, `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`);
    if (!r.ok) return { error: `Could not read the WhatsApp numbers: ${r.message}` };
    phone = r.data.data[0] ?? null;
  }
  if (!phone) return { error: "This WhatsApp Business Account has no phone number yet. Add one in the Facebook popup." };

  // New numbers must be registered on the Cloud API; an already-registered number just errors, which is fine.
  const pin = String(randomInt(100000, 1000000));
  const reg = await graph(token, `${phone.id}/register`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", pin }) });
  const sub = await subscribeApp(token, wabaId);

  const db = createAdminClient();
  const { data: existing } = await db.from("lb_wa_numbers").select("id,company_id").eq("phone_number_id", phone.id).maybeSingle();
  if (existing && existing.company_id !== me.company_id) return { error: "This number is already connected to another account." };
  const row = {
    waba_id: wabaId, display_phone: phone.display_phone_number, verified_name: phone.verified_name, quality_rating: phone.quality_rating ?? null,
    status: "connected", last_error: null, last_checked_at: new Date().toISOString(), provider: "cloud",
  };
  let numberId = existing?.id as string | undefined;
  if (numberId) {
    const { error } = await db.from("lb_wa_numbers").update(row).eq("id", numberId);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await db.from("lb_wa_numbers")
      .insert({ ...row, company_id: me.company_id, phone_number_id: phone.id, label: phone.verified_name || phone.display_phone_number }).select("id").single();
    if (error) return { error: error.message };
    numberId = data.id;
  }
  const { error } = await db.from("lb_wa_number_secrets").upsert({ number_id: numberId, access_token: encryptSecret(token), updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "wa_number.embedded_signup", numberId!, { waba_id: wabaId, phone_number_id: phone.id, registered: reg.ok, subscribed: sub.ok });
  const tpl = await syncTemplates(numberId!).catch(() => undefined);

  revalidatePath("/admin/integrations");
  revalidatePath("/admin/numbers");
  const notes = [
    reg.ok ? `Two-step verification PIN set to ${pin}. Save it somewhere safe.` : null,
    sub.ok ? null : `Webhook subscribe failed (${sub.message}); click Subscribe webhook in WhatsApp numbers.`,
    tpl?.ok ?? null,
  ].filter(Boolean);
  return { ok: [`Connected ${phone.verified_name} (${phone.display_phone_number}).`, ...notes].join(" ") };
}

type GwSession = { status: "starting" | "qr" | "connecting" | "connected" | "logged_out" | "expired"; qr?: string | null; phone?: string | null; name?: string | null };

const gw = <T>(path: string, init: RequestInit = {}) => graph<T>(process.env.WA_GATEWAY_KEY!, `${gatewayBase()}/${path}`, init);

/** Create a QR number row and ask the gateway for a fresh login QR. */
export async function startQrSession(label: string): Promise<{ error?: string; id?: string }> {
  const { profile: me } = await requireAdmin();
  if (!hasServiceRole()) return { error: "Server is not configured (SUPABASE_SERVICE_ROLE_KEY)." };
  if (!gatewayConfigured()) return { error: "QR connect needs the WhatsApp gateway server. Set WA_GATEWAY_URL and WA_GATEWAY_KEY in Vercel." };
  const db = createAdminClient();
  const sid = `qr_${randomBytes(12).toString("hex")}`;
  const { data, error } = await db.from("lb_wa_numbers").insert({
    company_id: me.company_id, label: label.trim().slice(0, 80) || "WhatsApp (QR)", phone_number_id: sid, waba_id: "qr",
    provider: "qr", status: "disconnected",
  }).select("id").single();
  if (error) return { error: error.message };
  const r = await gw<GwSession>("sessions", { method: "POST", body: JSON.stringify({ id: sid }) });
  if (!r.ok) {
    await db.from("lb_wa_numbers").delete().eq("id", data.id);
    return { error: `WhatsApp gateway: ${r.message}` };
  }
  await audit(me.company_id, me.id, "wa_number.qr_start", data.id);
  return { id: data.id };
}

async function ownQrNumber(companyId: string, id: string) {
  const { data } = await createAdminClient().from("lb_wa_numbers").select("id,phone_number_id,provider,status").eq("id", id).eq("company_id", companyId).maybeSingle();
  return data?.provider === "qr" ? data : null;
}

/** Polled by the QR dialog. Marks the number connected as soon as the phone has scanned. */
export async function qrSessionStatus(id: string): Promise<GwSession & { error?: string }> {
  const { profile: me } = await requireAdmin();
  const n = await ownQrNumber(me.company_id, id);
  if (!n || !gatewayConfigured()) return { status: "expired", error: "Session not found." };
  const r = await gw<GwSession>(`sessions/${n.phone_number_id}`);
  if (!r.ok) return { status: "connecting", error: r.message };
  if (r.data.status === "connected" && n.status !== "connected") {
    await createAdminClient().from("lb_wa_numbers").update({
      status: "connected", last_error: null, last_checked_at: new Date().toISOString(),
      display_phone: r.data.phone ? `+${r.data.phone}` : null, verified_name: r.data.name ?? null,
    }).eq("id", id);
    revalidatePath("/admin/integrations");
    revalidatePath("/admin/numbers");
  }
  return { status: r.data.status, qr: r.data.qr ?? null, phone: r.data.phone ?? null, name: r.data.name ?? null };
}

/** Closing the dialog before scanning drops the half-made number; a connected one is kept. */
export async function cancelQrSession(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const n = await ownQrNumber(me.company_id, id);
  if (!n || n.status === "connected") return { ok: "Kept." };
  if (gatewayConfigured()) await gw(`sessions/${n.phone_number_id}`, { method: "DELETE" });
  await createAdminClient().from("lb_wa_numbers").delete().eq("id", id).eq("status", "disconnected");
  revalidatePath("/admin/integrations");
  return { ok: "Cancelled." };
}

/** Log a QR number out of WhatsApp (the phone shows it under Linked devices until then). */
export async function logoutQrNumber(id: string): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const n = await ownQrNumber(me.company_id, id);
  if (!n) return { error: "Number not found." };
  if (gatewayConfigured()) {
    const r = await gw(`sessions/${n.phone_number_id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 404) return { error: `WhatsApp gateway: ${r.message}` };
  }
  await createAdminClient().from("lb_wa_numbers").update({ status: "disconnected", is_active: false, last_checked_at: new Date().toISOString() }).eq("id", id);
  await audit(me.company_id, me.id, "wa_number.qr_logout", id);
  revalidatePath("/admin/integrations");
  revalidatePath("/admin/numbers");
  return { ok: "Logged out." };
}
