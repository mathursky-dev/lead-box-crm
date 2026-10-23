"use server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/util";

type FormState = { error?: string; ok?: string } | undefined;

function ready(): string | null {
  if (!hasServiceRole()) return "Server is not configured: SUPABASE_SERVICE_ROLE_KEY is missing.";
  if (!process.env.LB_SECRETS_KEY) return "Server is not configured: LB_SECRETS_KEY is missing (needed to encrypt the App Secret).";
  return null;
}

async function audit(companyId: string, actorId: string, action: string, data: object) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity: "integration", entity_id: "whatsapp", data });
}

export async function saveMetaIntegration(_: FormState, form: FormData): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const notReady = ready();
  if (notReady) return { error: notReady };
  const appId = String(form.get("meta_app_id") ?? "").trim();
  const secret = String(form.get("app_secret") ?? "").trim();
  const clear = form.get("clear_secret") === "on";
  if (appId && !/^\d{5,30}$/.test(appId)) return { error: "Meta App ID must be digits." };
  if (secret && !/^[a-f0-9]{32}$/i.test(secret)) return { error: "App Secret should be the 32-character hex value from Meta App → Settings → Basic." };
  const row: Record<string, unknown> = { company_id: me.company_id, meta_app_id: appId || null, updated_by: me.id, updated_at: new Date().toISOString() };
  if (secret) row.app_secret_enc = encryptSecret(secret);
  else if (clear) row.app_secret_enc = null;
  const { error } = await createAdminClient().from("lb_integrations").upsert(row);
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "integration.meta.save", { meta_app_id: appId || null, secret_changed: Boolean(secret), secret_cleared: clear && !secret });
  revalidatePath("/admin/integrations");
  return { ok: "Integration settings saved." };
}

export async function generateVerifyToken(): Promise<FormState> {
  const { profile: me } = await requireAdmin();
  const notReady = ready();
  if (notReady) return { error: notReady };
  const token = `lb_${randomBytes(18).toString("hex")}`;
  const { error } = await createAdminClient().from("lb_integrations")
    .upsert({ company_id: me.company_id, verify_token: token, updated_by: me.id, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "integration.verify_token.rotate", {});
  revalidatePath("/admin/integrations");
  return { ok: "New verify token generated. Paste it into Meta and click Verify and save." };
}
