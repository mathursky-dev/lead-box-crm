import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { appOrigin } from "@/lib/care-server";
import { ivrSettings } from "@/lib/ivr";
import { IvrForms } from "./ui";

export const metadata = { title: "Cloud calling (IVR)" };

export default async function IvrPage() {
  const { profile } = await requireAdmin();
  if (!hasServiceRole()) return <ErrorBox message="Server is not configured (service role key)." />;
  const db = createAdminClient();
  const [{ data: users, error }, s, origin] = await Promise.all([
    db.from("lb_profiles").select("id,full_name,phone,ivr_phone,is_active").eq("company_id", profile.company_id).eq("is_active", true).order("full_name"),
    ivrSettings(db, profile.company_id),
    appOrigin(),
  ]);
  const header = <PageHeader title="Cloud calling (IVR)" icon="phone" tone="violet"
    sub="Call customers from the CRM through Exotel or Knowlarity. Your phone rings first, then the customer sees your company number. Every call and its recording is saved on the lead." />;
  if (error) return <>{header}<ErrorBox message="Cloud calling is not set up yet: the database update has to be run once (Supabase SQL)." /></>;
  return (
    <>
      {header}
      <IvrForms
        s={s ? { provider: s.provider, enabled: s.enabled, record: s.record, account_sid: s.account_sid ?? "", api_host: s.api_host ?? "", api_key: s.api_key ?? "", caller_id: s.caller_id ?? "", has_token: Boolean(s.api_token_enc) } : null}
        hookUrl={s ? `${origin}/api/ivr/${s.provider}/${s.hook_token}` : null}
        users={(users ?? []).map((u) => ({ id: u.id as string, name: u.full_name as string, phone: (u.phone as string) ?? "", ivr_phone: (u.ivr_phone as string) ?? "" }))}
      />
    </>
  );
}
