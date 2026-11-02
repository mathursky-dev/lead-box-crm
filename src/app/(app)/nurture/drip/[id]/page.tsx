import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader } from "@/components/static";
import { blankDrip, journeyToDrip } from "@/lib/drip";
import { DripBuilder } from "./builder";

export const metadata = { title: "Drip campaign" };

export default async function DripEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireProfile();
  if (!can(profile, "journeys.manage")) redirect("/nurture/drip");
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const refs = await loadRefs();
  const [{ data: j }, { data: steps }, { data: templates }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : sb.from("lb_journeys").select("id,name,status,trigger_type,trigger_config,number_id,pause_on_reply,current_version").eq("id", id).eq("company_id", profile.company_id).maybeSingle(),
    isNew ? Promise.resolve({ data: [] }) : sb.from("lb_journey_steps").select("type,config").eq("journey_id", id).order("step_no"),
    sb.from("lb_wa_templates").select("name,language,category,components").eq("company_id", profile.company_id).eq("status", "APPROVED").order("name"),
  ]);
  if (!isNew && !j) notFound();
  const draft = j ? journeyToDrip(j, (steps ?? []) as { type: string; config: Record<string, unknown> }[]) : blankDrip();
  if (j && !draft) redirect(`/nurture/journeys/${j.id}`); // edited into a full journey: use the journey editor

  return (
    <>
      <PageHeader icon="clock" tone="violet" title={isNew ? "New drip campaign" : j!.name}
        sub={<span className="flex flex-wrap items-center gap-2"><Link className="text-brand-700 hover:underline" href="/nurture/drip">← All drip campaigns</Link>
          {j && <span className="text-xs text-slate-500">· {j.status === "active" ? "on" : j.status === "draft" ? "off (draft)" : j.status}</span>}</span>} />
      <DripBuilder initial={draft!} active={j?.status === "active"}
        statuses={refs.statuses.filter((s) => s.is_active && !["won", "lost", "invalid"].includes(s.category)).map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        sources={refs.sources.filter((s) => s.is_active !== false).map((s) => ({ id: s.id, name: s.name }))}
        numbers={refs.numbers.filter((n) => n.is_active !== false).map((n) => ({ id: n.id, name: n.label }))}
        templates={(templates ?? []).map((t) => ({ name: t.name, language: t.language, category: t.category ?? "",
          body: ((t.components as { type: string; text?: string }[] | null)?.find((c) => c.type === "BODY")?.text) ?? "" }))} />
    </>
  );
}
