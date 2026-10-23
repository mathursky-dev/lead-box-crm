import "server-only";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { decryptSecret } from "./util";

/** Verify tokens accepted by the webhook handshake: server setting + Integration master. */
export async function webhookVerifyTokens() {
  const out = [process.env.WHATSAPP_VERIFY_TOKEN].filter(Boolean) as string[];
  if (hasServiceRole()) {
    const { data } = await createAdminClient().from("lb_integrations").select("verify_token").not("verify_token", "is", null);
    for (const r of data ?? []) out.push(r.verify_token!);
  }
  return out;
}

/** App secrets used to validate X-Hub-Signature-256: server setting + Integration master. */
export async function webhookAppSecrets() {
  const out = [process.env.WHATSAPP_APP_SECRET].filter(Boolean) as string[];
  if (hasServiceRole() && process.env.LB_SECRETS_KEY) {
    const { data } = await createAdminClient().from("lb_integrations").select("app_secret_enc").not("app_secret_enc", "is", null);
    for (const r of data ?? []) {
      try { out.push(decryptSecret(r.app_secret_enc!)); } catch { /* key rotated or corrupt: ignore this one */ }
    }
  }
  return out;
}
