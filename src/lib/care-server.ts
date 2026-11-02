import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { CARE_COLS, CARE_DEFAULTS, careUrl, type CareSettings } from "@/lib/care";

type Db = ReturnType<typeof createAdminClient>;

export async function appOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : process.env.APP_URL ?? "http://localhost:3000";
}

/** Company care settings (defaults when the company never saved them). null = the Customer care SQL is not applied yet. */
export async function careSettings(db: Db, companyId: string): Promise<CareSettings | null> {
  const { data, error } = await db.from("lb_care_settings").select(CARE_COLS).eq("company_id", companyId).maybeSingle();
  if (error) return null;
  return { ...CARE_DEFAULTS, ...((data ?? {}) as Partial<CareSettings>) };
}

/** Portal token + referral code of a customer (created on first use). */
export async function customerLinks(db: Db, customerId: string) {
  const { data, error } = await db.rpc("lb_customer_links", { p_customer: customerId });
  if (error || !data) return null;
  return data as { portal_token: string; referral_code: string };
}

/** Every customer-facing link for one lead. Caller must have checked the lead is visible. */
export async function leadCareLinks(companyId: string, customerId: string, leadId: string) {
  const db = createAdminClient();
  const [s, links, origin, { data: fb }] = await Promise.all([
    careSettings(db, companyId), customerLinks(db, customerId), appOrigin(),
    db.from("lb_feedback").select("id,token,status,score,comment,sent_at,answered_at").eq("lead_id", leadId).eq("company_id", companyId).maybeSingle(),
  ]);
  if (!s || !links) return null;
  return {
    settings: s,
    portal: s.portal_enabled ? careUrl(origin, "portal", links.portal_token) : null,
    booking: s.booking_enabled && s.booking_code ? careUrl(origin, "booking", s.booking_code) : null,
    referral: s.referral_enabled ? careUrl(origin, "referral", links.referral_code) : null,
    feedback: fb ? { ...fb, url: careUrl(origin, "feedback", fb.token as string) } : null,
  };
}
