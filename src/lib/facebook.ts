import "server-only";
import { createAdminClient } from "./supabase/server";
import { decryptSecret, normalizePhone } from "./util";
import { graph } from "./whatsapp";

export const FB_SCOPES = "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_manage_ads,leads_retrieval,ads_read,business_management";

/** Company's Meta app (Admin → Integrations). */
export async function fbApp(companyId: string) {
  const { data } = await createAdminClient().from("lb_integrations").select("meta_app_id,app_secret_enc").eq("company_id", companyId).maybeSingle();
  if (!data?.meta_app_id || !data.app_secret_enc) return null;
  return { appId: data.meta_app_id as string, secret: decryptSecret(data.app_secret_enc) };
}

/** Connected Meta account with the decrypted long-lived user token. */
export async function fbAccount(companyId: string) {
  const { data } = await createAdminClient().from("lb_fb_accounts").select("*").eq("company_id", companyId).maybeSingle();
  if (!data) return null;
  return { ...data, token: decryptSecret(data.user_token_enc) } as {
    company_id: string; fb_user_id: string; fb_user_name: string | null; token_expires_at: string | null; only_selected: boolean; token: string;
  };
}

type FieldData = { name: string; values?: string[] }[];

/** Map Lead Ads field_data to the lb_ingest_fb_lead payload fields. */
export function mapLeadFields(fields: FieldData) {
  const get = (...names: string[]) => fields.find((f) => names.includes(f.name.toLowerCase()))?.values?.[0]?.trim() || "";
  const name = get("full_name") || [get("first_name"), get("last_name")].filter(Boolean).join(" ");
  const location = [get("city"), get("state")].filter(Boolean).join(", ");
  return {
    phone_e164: normalizePhone(get("phone_number", "phone")),
    name, email: get("email"), location,
    qa: fields.map((f) => `${f.name}: ${(f.values ?? []).join(", ")}`),
  };
}

/** Process one stored leadgen event. Errors are recorded on the event row. */
export async function processFbLead(eventId: string) {
  const db = createAdminClient();
  const { data: ev } = await db.from("lb_fb_lead_events").select("*").eq("id", eventId).single();
  if (!ev || ev.status !== "received") return;
  const done = (patch: Record<string, unknown>) => db.from("lb_fb_lead_events").update(patch).eq("id", ev.id);
  try {
    const { data: page } = await db.from("lb_fb_pages").select("*").eq("page_id", ev.page_id).single();
    const { data: acct } = await db.from("lb_fb_accounts").select("only_selected").eq("company_id", ev.company_id).maybeSingle();
    if (acct?.only_selected) {
      const { data: ads } = await db.from("lb_fb_ads").select("ad_id").eq("company_id", ev.company_id);
      if (!page.is_selected || (ads?.length && !ads.some((a) => a.ad_id === ev.ad_id))) {
        await done({ status: "skipped", error: "Page or ad not selected" });
        return;
      }
    }
    const r = await graph<{ field_data: FieldData; ad_id?: string; form_id?: string }>(decryptSecret(page.page_token_enc),
      `${ev.leadgen_id}?fields=field_data,created_time,ad_id,form_id`);
    if (!r.ok) throw new Error(`Graph: ${r.message}`);
    const m = mapLeadFields(r.data.field_data ?? []);
    const adId = r.data.ad_id ?? ev.ad_id;
    const formId = r.data.form_id ?? ev.form_id;
    const notes = [`Facebook lead · page ${page.page_name ?? page.page_id} · form ${formId ?? "-"} · ad ${adId ?? "-"}`, ...m.qa].join("\n");
    const { data, error } = await db.rpc("lb_ingest_fb_lead", {
      p: { company_id: ev.company_id, leadgen_id: ev.leadgen_id, page_id: ev.page_id, form_id: formId, ad_id: adId,
        phone_e164: m.phone_e164, name: m.name, email: m.email, location: m.location, notes, fields: r.data.field_data },
    });
    if (error) throw new Error(`ingest: ${error.message}`);
    await done({ status: data.status, lead_id: data.lead_id ?? null, error: data.reason ?? null });
    await db.from("lb_fb_pages").update({ last_lead_at: new Date().toISOString() }).eq("id", page.id);
  } catch (e) {
    await done({ status: "error", error: (e as Error).message.slice(0, 500) });
  }
}
