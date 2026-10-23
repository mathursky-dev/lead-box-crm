import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { JourneyEditor } from "./editor";
import { JourneyButtons } from "../journey-buttons";
import { TEMPLATES, type JourneyDraft } from "../journey-model";

export const metadata = { title: "Journey" };

const BLANK: JourneyDraft = {
  name: "", description: "", trigger_type: "status_entered", trigger_config: { category: "interested" }, priority: 100, number_id: "",
  pause_on_reply: true, stop_on_purchase: true, stop_on_lost: true, stop_on_manual_takeover: true, stop_on_payment: false, stop_on_complaint: true,
  steps: [{ type: "message", config: {}, next_step: null }, { type: "delay", config: { minutes: 1440 }, next_step: null }, { type: "task", config: { title: "Call the customer", action_type: "call", due_in_hours: 4 }, next_step: null }],
};

export default async function JourneyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const { profile } = await requireProfile();
  const isNew = id === "new";
  if (isNew && !can(profile, "journeys.manage")) redirect("/nurture/journeys");
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  if (isNew && !t) {
    return (
      <>
        <PageHeader title="New journey" sub={<Link className="text-brand-700 hover:underline" href="/nurture/journeys">← All journeys</Link>} />
        <p className="mb-3 text-sm text-slate-600">Start from a template and adjust it, or start blank. Nothing runs until you preview and publish.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((x) => (
            <Link key={x.key} href={`/nurture/journeys/new?t=${x.key}`} className="card block p-4 transition hover:border-brand-500">
              <div className="font-semibold text-navy-900">{x.title}</div>
              <p className="mt-1 text-sm text-slate-600">{x.blurb}</p>
              <p className="mt-2 text-xs text-slate-400">{x.draft.steps.length} steps</p>
            </Link>
          ))}
          <Link href="/nurture/journeys/new?t=blank" className="card block border-dashed p-4 hover:border-brand-500">
            <div className="font-semibold text-navy-900">Blank journey</div><p className="mt-1 text-sm text-slate-600">Build from scratch.</p>
          </Link>
        </div>
      </>
    );
  }

  const sb = await createClient();
  const refs = await loadRefs();
  const [{ data: j }, { data: steps }, { data: templates }, { data: offers }, { data: segments }, { data: events }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : sb.from("lb_journeys").select("*").eq("id", id).maybeSingle(),
    isNew ? Promise.resolve({ data: [] }) : sb.from("lb_journey_steps").select("step_no,type,config,next_step").eq("journey_id", id).order("step_no"),
    sb.from("lb_wa_templates").select("name,language,category,waba_id,components").eq("status", "APPROVED").order("name"),
    sb.from("lb_offers").select("id,name,status,valid_to").order("created_at", { ascending: false }),
    sb.from("lb_segments").select("id,name").order("name"),
    isNew ? Promise.resolve({ data: [] }) : sb.from("lb_journey_events").select("id,step_no,event,detail,created_at,enrollment:lb_journey_enrollments(lead_id)").eq("journey_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (!isNew && !j) notFound();
  const draft: JourneyDraft = j ? {
    id: j.id, name: j.name, description: j.description ?? "", trigger_type: j.trigger_type, trigger_config: j.trigger_config ?? {}, priority: j.priority,
    number_id: j.number_id ?? "", pause_on_reply: j.pause_on_reply, stop_on_purchase: j.stop_on_purchase, stop_on_lost: j.stop_on_lost,
    stop_on_manual_takeover: j.stop_on_manual_takeover, stop_on_payment: j.stop_on_payment, stop_on_complaint: j.stop_on_complaint,
    steps: (steps ?? []).map((s) => ({ type: s.type, config: s.config ?? {}, next_step: s.next_step ?? null })),
  } : structuredClone(TEMPLATES.find((x) => x.key === t)?.draft ?? BLANK);
  const manage = can(profile, "journeys.manage");
  return (
    <>
      <PageHeader title={isNew ? "New journey" : j!.name}
        sub={<span className="flex flex-wrap items-center gap-2"><Link className="text-brand-700 hover:underline" href="/nurture/journeys">← All journeys</Link>
          {j && <span className="text-xs text-slate-500">· {j.status} · {j.current_version ? `published v${j.current_version}` : "never published"}</span>}</span>}
        actions={!isNew && manage ? <JourneyButtons id={j!.id} status={j!.status} published={j!.current_version > 0} /> : null} />
      <JourneyEditor draft={draft} readOnly={!manage}
        templates={(templates ?? []).map((x) => ({ name: x.name, language: x.language, category: x.category, waba_id: x.waba_id, body: ((x.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")?.text) ?? "" }))}
        offers={(offers ?? []).map((o) => ({ id: o.id, name: `${o.name} (${o.status})` }))}
        segments={segments ?? []} numbers={refs.numbers.map((n) => ({ id: n.id, name: n.label }))}
        products={refs.products} sources={refs.sources}
        users={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))} tags={refs.tags} />
      {!isNew && (
        <section className="card mt-5 p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-navy-900">Recent activity</h2>
            <Link className="text-xs text-brand-700 hover:underline" href={`/nurture/logs?journey=${id}`}>Full execution log →</Link></div>
          {!events?.length ? <p className="text-sm text-slate-500">No activity yet.</p> : (
            <ul className="divide-y text-sm">{events.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 py-1.5">
                <span><span className="font-medium">{e.event.replace(/_/g, " ")}</span>{e.step_no ? ` · step ${e.step_no}` : ""}{e.detail ? ` · ${e.detail}` : ""}
                  {" "}<Link className="text-xs text-brand-700 hover:underline" href={`/leads/${(e.enrollment as unknown as { lead_id: string }).lead_id}`}>lead</Link></span>
                <span className="text-xs text-slate-400">{fmtDateTime(e.created_at)}</span>
              </li>))}</ul>
          )}
        </section>
      )}
    </>
  );
}
