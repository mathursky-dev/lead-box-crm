import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader } from "@/components/static";
import { DEFAULT_SPEC, type ReportSpec } from "@/lib/report-spec";
import { Builder, type Saved } from "./builder";

export const metadata = { title: "Report Builder" };
export const dynamic = "force-dynamic";

export default async function ReportBuilderPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  if (!can(profile, "reports.view")) redirect("/dashboard");
  const refs = await loadRefs();
  const sb = await createClient();
  const { data, error } = await sb.from("lb_saved_reports").select("id,name,spec,is_shared,user_id,updated_at")
    .eq("company_id", profile.company_id).order("name").limit(200);
  const saved = ((data ?? []) as (Omit<Saved, "mine"> & { user_id: string })[]).map((r) => ({ ...r, spec: { ...DEFAULT_SPEC, ...(r.spec as Partial<ReportSpec>) }, mine: r.user_id === profile.id }));
  const opt = (l: { id: string; name?: string; full_name?: string; is_active?: boolean }[]) => l.map((x) => ({ id: x.id, name: x.name ?? x.full_name ?? "" }));
  return (
    <>
      <PageHeader icon="sliders" tone="violet" title="Custom report builder"
        sub="Pick what to group by, which numbers to show and a chart. Save it, or download it as Excel." />
      <Builder saved={saved} savedReady={!error} initialId={sp.r ?? null} canShare={profile.role !== "agent"}
        opts={{ statuses: opt(refs.statuses), sources: opt(refs.sources), owners: opt(refs.users), products: opt(refs.products) }} />
    </>
  );
}
