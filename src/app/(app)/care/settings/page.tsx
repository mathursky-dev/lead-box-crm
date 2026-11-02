import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox, PageHeader } from "@/components/static";
import { careSettings } from "@/lib/care-server";
import { retentionSettings, RET_NOT_READY } from "@/lib/retention-server";
import { newBookingCode } from "@/lib/actions/care";
import { CareSettingsForms } from "../ui";
import { RetentionSettingsForms } from "../retention-ui";

export const metadata = { title: "Customer care settings" };

export default async function CareSettingsPage() {
  const { profile } = await requireAdmin();
  if (!hasServiceRole()) return <ErrorBox message="The server is not configured (service role key)." />;
  const db = createAdminClient();
  const [s, r, refs, { data: tpls }] = await Promise.all([
    careSettings(db, profile.company_id), retentionSettings(db, profile.company_id), loadRefs(),
    db.from("lb_wa_templates").select("name,language,category,status").eq("company_id", profile.company_id).order("name").limit(500),
  ]);
  const seen = new Set<string>();
  const templates = (tpls ?? []).filter((t) => String(t.status).toUpperCase() === "APPROVED" && !seen.has(`${t.name}|${t.language}`) && seen.add(`${t.name}|${t.language}`))
    .map((t) => ({ name: t.name as string, language: t.language as string, category: (t.category as string | null) ?? null }));
  const numbers = refs.numbers.filter((n) => n.is_active).map((n) => ({ id: n.id, label: `${n.label}${n.display_phone ? ` · ${n.display_phone}` : ""}` }));
  return (
    <div className="space-y-6">
      {s ? <CareSettingsForms s={s} sources={refs.sources.filter((x) => x.is_active !== false)} defaultCode={await newBookingCode()} />
        : <ErrorBox message="Customer care is not set up yet: the database update has to be run once (Supabase SQL)." />}
      <PageHeader icon="trophy" tone="green" title="Loyalty, tickets, renewals & wishes" sub="Automatic WhatsApp messages here are off until you turn them on." />
      {r ? <RetentionSettingsForms s={r} numbers={numbers} templates={templates} /> : <ErrorBox message={RET_NOT_READY} />}
    </div>
  );
}
