import { notFound } from "next/navigation";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { newGraph, normalizeGraph } from "@/lib/wa-flow";
import { FlowEditor } from "./editor";

export const metadata = { title: "Flow editor · WhatsApp" };

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const isNew = id === "new";
  const [flow, { data: numbers }, { data: tags }, { data: templates }, { data: agents }] = await Promise.all([
    isNew ? Promise.resolve(null) : sb.from("lb_wa_flows").select("*").eq("id", id).maybeSingle().then((r) => r.data),
    sb.from("lb_wa_numbers").select("id,label").order("label"),
    sb.from("lb_tags").select("name").order("name"),
    sb.from("lb_wa_templates").select("name,language,components").eq("status", "APPROVED").order("name"),
    sb.from("lb_profiles").select("id,full_name").eq("is_active", true).order("full_name"),
  ]);
  if (!isNew && !flow) notFound();
  const meta = flow
    ? { name: flow.name, description: flow.description, trigger_type: flow.trigger_type, keywords: flow.keywords ?? [], match_type: flow.match_type, number_id: flow.number_id,
        tag_names: flow.tag_names ?? [], priority: flow.priority, is_active: flow.is_active }
    : { name: "", description: null, trigger_type: "keywords" as const, keywords: [], match_type: "contains" as const, number_id: null, tag_names: [], priority: 10, is_active: false };
  return (
    <FlowEditor key={id} flowId={flow?.id ?? null} initialMeta={meta} initialGraph={flow ? normalizeGraph(flow.graph) : newGraph()} canEdit={isAdmin(profile)}
      lookups={{
        numbers: numbers ?? [], tags: (tags ?? []).map((t) => t.name), agents: agents ?? [],
        templates: (templates ?? []).map((t) => ({ name: t.name, language: t.language, body: ((t.components as { type: string; text?: string }[]).find((x) => x.type === "BODY")?.text) ?? "" })),
      }} />
  );
}
