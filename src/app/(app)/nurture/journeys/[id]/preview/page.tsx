import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader } from "@/components/static";
import { TRIGGERS, describeStep, type Step } from "../../journey-model";
import { PublishBox } from "./publish-box";

export const metadata = { title: "Preview journey" };

type Preview = {
  journey: { id: string; name: string; status: string; trigger_type: string; trigger_config: Record<string, string>; current_version: number;
    pause_on_reply: boolean; stop_on_purchase: boolean; stop_on_lost: boolean; stop_on_manual_takeover: boolean; stop_on_payment: boolean; stop_on_complaint: boolean };
  audience: { label: string; total: number; eligible?: number; sample?: string[] };
  warnings: string[];
  steps: (Step & { step_no: number })[];
  running: { version: number; status: string; n: number }[];
  unpublished_changes: boolean;
};

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireProfile();
  if (!can(profile, "journeys.manage")) redirect(`/nurture/journeys/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const [{ data, error }, refs] = await Promise.all([sb.rpc("lb_journey_preview", { p_journey: id }), loadRefs()]);
  if (error) return <PageHeader title="Preview" sub={<span className="text-red-600">{error.message}</span>} />;
  const p = data as Preview;
  const j = p.journey;
  const names = { users: new Map(refs.users.map((u) => [u.id, u.full_name])), tags: new Map(refs.tags.map((t) => [t.id, t.name])) };
  const stops = ([["pause_on_reply", "pauses on reply"], ["stop_on_manual_takeover", "stops on manual takeover"], ["stop_on_purchase", "stops on purchase"],
    ["stop_on_payment", "stops on payment"], ["stop_on_complaint", "stops on complaint"], ["stop_on_lost", "stops on lost/invalid"]] as const).filter(([k]) => j[k]).map(([, l]) => l);

  return (
    <>
      <PageHeader title={`Preview: ${j.name}`} sub={<Link className="text-brand-700 hover:underline" href={`/nurture/journeys/${id}`}>← Back to builder</Link>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Who it reaches</h2>
            <p className="text-sm text-slate-600">Trigger: <b>{TRIGGERS.find(([k]) => k === j.trigger_type)?.[1]}</b>{j.trigger_config?.category ? ` (${j.trigger_config.category})` : ""}{j.trigger_config?.days ? ` (${j.trigger_config.days} days)` : ""}</p>
            <p className="mt-2 text-3xl font-bold text-navy-900">{p.audience.total ?? 0}</p>
            <p className="text-xs text-slate-500">{p.audience.label}</p>
            {p.audience.eligible != null && <p className="mt-1 text-sm">{p.audience.eligible} have WhatsApp opt-in and can receive messages.</p>}
            {!!p.audience.sample?.length && <p className="mt-1 text-xs text-slate-500">e.g. {p.audience.sample.join(", ")}</p>}
            <p className="mt-2 text-xs text-slate-500">Before every send: opt-in, opt-out, suppression, global/customer pause, frequency cap and quiet hours (marketing), and the 24-hour/template rule are rechecked. Conflicting journeys: a lead runs one journey at a time.</p>
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">What it does</h2>
            <ol className="space-y-1 text-sm">{p.steps.map((s) => {
              const c = s.config as Record<string, string>;
              return <li key={s.step_no}><span className="mr-1 text-xs font-semibold text-slate-400">{s.step_no}.</span>{describeStep(s, names)}
                {(s.type === "branch" || s.type === "wait_reply") && <span className="ml-1 text-xs text-slate-500">→ {c.then_step ?? "?"} / {c.else_step ?? "?"}</span>}
                {s.next_step ? <span className="ml-1 text-xs text-sky-700">↪ {s.next_step}</span> : null}</li>;
            })}</ol>
            <p className="mt-2 text-xs text-slate-500">Automation {stops.join(", ")}; opt-out always stops it.</p>
          </section>
        </div>
        <div className="space-y-4">
          {p.warnings.length > 0 && (
            <section className="card border-amber-300 bg-amber-50 p-4">
              <h2 className="mb-1 text-sm font-semibold text-amber-900">Check before publishing</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </section>
          )}
          <section className="card p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Versions</h2>
            <p>Status: <b className="capitalize">{j.status}</b> · {j.current_version ? `live version v${j.current_version}` : "never published"}</p>
            <p className={p.unpublished_changes ? "text-amber-700" : "text-slate-500"}>{p.unpublished_changes ? "The builder has changes that are not published yet." : "No unpublished changes."}</p>
            {p.running.length > 0 && <p className="mt-1 text-slate-600">Running now: {p.running.map((r) => `${r.n} ${r.status} on v${r.version}`).join(", ")} — they finish on their own version.</p>}
          </section>
          <PublishBox id={id} next={j.current_version + 1} canPublish={p.unpublished_changes || j.status !== "active"} hasWarnings={p.warnings.length > 0} />
        </div>
      </div>
    </>
  );
}
