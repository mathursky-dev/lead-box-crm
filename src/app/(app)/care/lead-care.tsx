import { createClient, hasServiceRole } from "@/lib/supabase/server";
import { leadCareLinks } from "@/lib/care-server";
import { LeadCareUi } from "./lead-care-ui";

// "Customer care" panel on the lead page: portal / booking / feedback / referral links, appointments, referrer.
export async function LeadCare({ leadId, companyId, customerId, canSend, canEdit, users }: {
  leadId: string; companyId: string; customerId: string; canSend: boolean; canEdit: boolean; users: { id: string; name: string }[];
}) {
  if (!hasServiceRole()) return null;
  const links = await leadCareLinks(companyId, customerId, leadId).catch(() => null);
  if (!links) return null; // Customer care SQL not applied yet.
  const sb = await createClient();
  const [{ data: appts }, { data: ref }, { count: referred }] = await Promise.all([
    sb.from("lb_appointments").select("id,appt_no,starts_at,status").eq("lead_id", leadId).order("starts_at", { ascending: false }).limit(5),
    sb.from("lb_referrals").select("status,referrer:lb_customers!lb_referrals_referrer_customer_id_fkey(name,phone_e164)").eq("lead_id", leadId).maybeSingle(),
    sb.from("lb_referrals").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("referrer_customer_id", customerId),
  ]);
  const r = ref?.referrer as unknown as { name: string | null; phone_e164: string } | null;
  return (
    <LeadCareUi
      leadId={leadId} canSend={canSend} canEdit={canEdit} users={users}
      links={{ portal: links.portal, booking: links.booking, referral: links.referral }}
      feedback={links.feedback ? { status: links.feedback.status as string, score: links.feedback.score as number | null, comment: links.feedback.comment as string | null, url: links.feedback.url } : null}
      appts={(appts ?? []).map((a) => ({ id: a.id as string, no: a.appt_no as number, at: a.starts_at as string, status: a.status as string }))}
      referredBy={r ? `${r.name || r.phone_e164}${r.name ? ` (${r.phone_e164})` : ""}` : null}
      referredCount={referred ?? 0}
    />
  );
}
