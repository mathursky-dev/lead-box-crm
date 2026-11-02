import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { decryptSecret } from "@/lib/util";
import { PageHeader, ErrorBox } from "@/components/static";
import { widgetConfig } from "@/lib/widget";
import { LeadSources, type ConnRow } from "./ui";

export const metadata = { title: "Lead sources" };

export default async function LeadSourcesPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { profile } = await requireAdmin();
  if (!hasServiceRole()) return <ErrorBox message="Server is not configured (service role key)." />;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "wacrm.leadboxs.in"}`;
  const db = createAdminClient();
  const [{ data, error }, refs, { data: nums }, sp] = await Promise.all([
    db.from("lb_lead_connectors").select("id,kind,name,token,secret_enc,source_id,product_id,department_id,tag_id,config,is_active,leads_count,duplicate_count,last_lead_at,last_sync_at,last_error,last_error_at,created_at")
      .eq("company_id", profile.company_id).order("created_at"),
    loadRefs(),
    db.from("lb_wa_numbers").select("display_phone").eq("company_id", profile.company_id).not("display_phone", "is", null).limit(1),
    searchParams,
  ]);
  if (error) return <ErrorBox message={error.message} />;
  const rows: ConnRow[] = (data ?? []).map(({ secret_enc, ...c }) => {
    let google_key: string | null = null;
    if (c.kind === "google" && secret_enc) { try { google_key = decryptSecret(secret_enc); } catch { google_key = null; } }
    return { ...c, has_secret: Boolean(secret_enc), google_key, config: c.kind === "widget" ? widgetConfig(c.config) : c.config };
  });
  const opt = (l: { id: string; name: string; is_active?: boolean }[]) => l.filter((x) => x.is_active !== false).map(({ id, name }) => ({ id, name }));
  return (
    <>
      <PageHeader icon="link" title="Lead sources" sub="Google Ads, IndiaMART, JustDial, website chat and any other software: leads come straight into the CRM, with the same duplicate check as everywhere else." />
      <LeadSources rows={rows} origin={origin} initialKind={sp.kind} defaultWa={(nums?.[0]?.display_phone ?? "").replace(/\D/g, "")}
        refs={{ sources: opt(refs.sources), products: opt(refs.products), departments: opt(refs.departments), tags: refs.tags.map(({ id, name }) => ({ id, name })) }} />
    </>
  );
}
