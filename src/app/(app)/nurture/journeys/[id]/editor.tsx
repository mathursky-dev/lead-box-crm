"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveJourney } from "@/lib/actions/nurture";
import { TRIGGERS, STEP_TYPES, CONDITIONS, CATS, describeStep, type JourneyDraft, type Step } from "../journey-model";

type Opt = { id: string; name: string };
type Tpl = { name: string; language: string; category: string | null; waba_id: string; body: string };
const TOKENS = "Tokens: {{name}} {{first_name}} {{offer_name}} {{offer_code}} {{offer_valid_to}}";

export function JourneyEditor({ draft, readOnly, templates, offers, segments, numbers, products, sources, users, tags }: {
  draft: JourneyDraft; readOnly: boolean; templates: Tpl[]; offers: Opt[]; segments: Opt[]; numbers: Opt[]; products: Opt[]; sources: Opt[]; users: Opt[]; tags: Opt[];
}) {
  const [d, setD] = useState<JourneyDraft>(draft);
  const [err, setErr] = useState<string>();
  const [ok, setOk] = useState<string>();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const set = (patch: Partial<JourneyDraft>) => setD((x) => ({ ...x, ...patch }));
  const setStep = (i: number, patch: Partial<Step>) => setD((x) => ({ ...x, steps: x.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const setCfg = (i: number, k: string, v: unknown) => setD((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, config: { ...s.config, [k]: v } } : s)) }));
  const move = (i: number, dir: -1 | 1) => setD((x) => { const s = [...x.steps]; const t = s[i + dir]; if (!t) return x; s[i + dir] = s[i]; s[i] = t; return { ...x, steps: s }; });
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const tagMap = useMemo(() => new Map(tags.map((u) => [u.id, u.name])), [tags]);
  const select = (value: string, onChange: (v: string) => void, opts: [string, string][], placeholder = "—") => (
    <select className="input" value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  );

  const save = () => start(async () => {
    setErr(undefined); setOk(undefined);
    const r = await saveJourney({ ...d, id: d.id ?? "", steps: d.steps.map((s) => ({ ...s, next_step: s.next_step ?? "" })) });
    if (r.error) { setErr(r.error); return; }
    setOk("Draft saved. Preview & publish to make it live."); if (!d.id && r.id) router.push(`/nurture/journeys/${r.id}`); else router.refresh();
  });

  const s = d.steps[sel];
  const c = (s?.config ?? {}) as Record<string, string>;

  return (
    <div className="space-y-4">
      <section className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block sm:col-span-2"><span className="label">Name</span><input className="input" value={d.name} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="label">Priority (lower wins conflicts)</span><input className="input" type="number" value={d.priority} disabled={readOnly} onChange={(e) => set({ priority: Number(e.target.value) })} /></label>
        <label className="block"><span className="label">Default WhatsApp number</span>{select(d.number_id, (v) => set({ number_id: v }), numbers.map((n) => [n.id, n.name]), "Lead's number / first connected")}</label>
        <label className="block sm:col-span-2"><span className="label">Trigger — starts when</span>{select(d.trigger_type, (v) => set({ trigger_type: v, trigger_config: {} }), TRIGGERS)}</label>
        {d.trigger_type === "status_entered" && <label className="block"><span className="label">Status category</span>{select(d.trigger_config.category ?? "", (v) => set({ trigger_config: { ...d.trigger_config, category: v } }), CATS.slice(0, 6).map((x) => [x, x.replace("_", " ")]))}</label>}
        {d.trigger_type === "segment" && <label className="block"><span className="label">Segment</span>{select(d.trigger_config.segment_id ?? "", (v) => set({ trigger_config: { segment_id: v } }), segments.map((x) => [x.id, x.name]))}</label>}
        {d.trigger_type === "days_after_won" && <label className="block"><span className="label">Days after conversion</span><input className="input" type="number" min={1} disabled={readOnly} value={d.trigger_config.days ?? "30"} onChange={(e) => set({ trigger_config: { days: e.target.value } })} /></label>}
        {!["segment", "manual", "days_after_won"].includes(d.trigger_type) && (
          <>
            <label className="block"><span className="label">Only for product</span>{select(d.trigger_config.product_id ?? "", (v) => set({ trigger_config: { ...d.trigger_config, product_id: v } }), products.map((p) => [p.id, p.name]), "Any")}</label>
            <label className="block"><span className="label">Only for source</span>{select(d.trigger_config.source_id ?? "", (v) => set({ trigger_config: { ...d.trigger_config, source_id: v } }), sources.map((p) => [p.id, p.name]), "Any")}</label>
          </>
        )}
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:col-span-2 lg:col-span-4">
          {([["pause_on_reply", "Pause when customer replies"], ["stop_on_manual_takeover", "Stop on manual takeover"], ["stop_on_purchase", "Stop on purchase"],
            ["stop_on_payment", "Stop when payment received"], ["stop_on_complaint", "Stop on complaint"], ["stop_on_lost", "Stop when Lost/Invalid"]] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" disabled={readOnly} checked={d[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<JourneyDraft>)} /> {l}</label>
          ))}
          <span className="text-xs text-slate-500">Opt-out and suppression always stop it. A “Wait for reply” step continues on a reply instead of pausing.</span>
        </fieldset>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Visual flow */}
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Flow</h2>
          <div className="flex flex-col items-stretch">
            <div className="rounded-lg border-2 border-navy-700 bg-navy-900 px-3 py-2 text-center text-sm text-white">⚡ {TRIGGERS.find(([k]) => k === d.trigger_type)?.[1]}</div>
            {d.steps.map((step, i) => {
              const cfg = step.config as Record<string, string>;
              const icon = STEP_TYPES.find(([k]) => k === step.type)?.[2] ?? "•";
              const forks = step.type === "branch" || step.type === "wait_reply";
              const jump = !forks && step.next_step && step.next_step !== i + 2 ? step.next_step : null;
              return (
                <div key={i} className="flex flex-col items-center">
                  <div className="h-4 w-px bg-slate-300" /><div className="text-[10px] leading-none text-slate-300">▼</div>
                  <button onClick={() => setSel(i)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${sel === i ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-slate-400"} ${forks ? "border-dashed" : ""}`}>
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-xs">{icon}</span>
                    <span className="text-xs font-semibold text-slate-400">{i + 1}.</span> {describeStep(step, { users: userMap, tags: tagMap })}
                    {forks && (
                      <span className="mt-1 flex gap-2 text-xs">
                        <span className="rounded bg-brand-100 px-1.5 text-brand-700">{step.type === "wait_reply" ? "reply" : "yes"} → {cfg.then_step ?? "?"}</span>
                        <span className="rounded bg-slate-100 px-1.5 text-slate-600">{step.type === "wait_reply" ? "timeout" : "no"} → {cfg.else_step ?? "?"}</span>
                      </span>
                    )}
                    {jump && <span className="mt-1 block text-xs text-sky-700">↪ then step {jump}</span>}
                  </button>
                </div>
              );
            })}
            <div className="h-4 w-px self-center bg-slate-300" />
            <div className="self-center rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-600">done</div>
          </div>
          {!readOnly && (
            <div className="mt-4 flex flex-wrap gap-1">
              {STEP_TYPES.map(([t, l, icon]) => (
                <button key={t} className="btn-ghost btn-sm" onClick={() => { setD((x) => ({ ...x, steps: [...x.steps, { type: t, config: t === "delay" ? { minutes: 1440 } : t === "wait_reply" ? { minutes: 1440 } : {}, next_step: null }] })); setSel(d.steps.length); }}>
                  {icon} {l}</button>
              ))}
            </div>
          )}
        </section>

        {/* Step inspector */}
        <section className="card p-4">
          {!s ? <p className="text-sm text-slate-500">Add a step to begin.</p> : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-navy-900 px-2 py-0.5 text-xs font-bold text-white">Step {sel + 1}</span>
                <select className="input w-44 py-1" value={s.type} disabled={readOnly} onChange={(e) => setStep(sel, { type: e.target.value, config: {} })}>
                  {STEP_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
                </select>
                {!readOnly && <span className="ml-auto flex gap-1">
                  <button className="btn-ghost btn-sm" onClick={() => { move(sel, -1); setSel(Math.max(0, sel - 1)); }} disabled={sel === 0} aria-label="Move up">↑</button>
                  <button className="btn-ghost btn-sm" onClick={() => { move(sel, 1); setSel(Math.min(d.steps.length - 1, sel + 1)); }} disabled={sel === d.steps.length - 1} aria-label="Move down">↓</button>
                  <button className="btn-ghost btn-sm text-red-700" onClick={() => { setD((x) => ({ ...x, steps: x.steps.filter((_, k) => k !== sel) })); setSel(Math.max(0, sel - 1)); }}>Remove</button>
                </span>}
              </div>

              {s.type === "message" && (() => {
                const tpl = templates.find((t) => t.name === c.template_name && t.language === c.template_language);
                const n = tpl ? new Set(tpl.body.match(/\{\{\d+\}\}/g) ?? []).size : 0;
                const params = (s.config.params as string[] | undefined) ?? [];
                return (
                  <>
                    <label className="block"><span className="label">Approved template (business-initiated messages must use one)</span>
                      {select(c.template_name ? `${c.template_name}|${c.template_language}` : "", (v) => { const [a, b] = v.split("|"); setCfg(sel, "template_name", a); setCfg(sel, "template_language", b); },
                        [...new Map(templates.map((t) => [`${t.name}|${t.language}`, `${t.name} (${t.language}) · ${t.category ?? ""}`])).entries()], "Choose…")}</label>
                    {tpl && <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">{tpl.body}</p>}
                    {tpl && <p className="text-xs text-slate-500">{(tpl.category ?? "").toUpperCase() === "MARKETING" ? "Marketing: frequency cap and quiet hours apply." : "Utility: sent outside quiet hours too; still needs opt-in."}</p>}
                    {Array.from({ length: n }).map((_, k) => (
                      <input key={k} className="input" disabled={readOnly} placeholder={`{{${k + 1}}} value`} value={params[k] ?? ""}
                        onChange={(e) => { const p = [...params]; p[k] = e.target.value; setCfg(sel, "params", p); }} />
                    ))}
                    {n > 0 && <p className="text-xs text-slate-400">{TOKENS}</p>}
                    <label className="block"><span className="label">Offer (optional)</span>{select(c.offer_id ?? "", (v) => setCfg(sel, "offer_id", v), offers.map((o) => [o.id, o.name]), "None")}</label>
                  </>
                );
              })()}
              {(s.type === "delay" || s.type === "wait_reply") && (
                <label className="block max-w-xs"><span className="label">{s.type === "delay" ? "Wait (minutes)" : "Wait up to (minutes) for a reply"} — 60 = 1 h, 1440 = 1 day</span>
                  <input className="input" type="number" min={1} disabled={readOnly} value={c.minutes ?? (s.type === "delay" ? 60 : 1440)} onChange={(e) => setCfg(sel, "minutes", Number(e.target.value))} /></label>
              )}
              {s.type === "branch" && (
                <>
                  <label className="block"><span className="label">If</span>{select(c.condition ?? "", (v) => setCfg(sel, "condition", v), CONDITIONS, "Choose…")}</label>
                  {c.condition === "status_in" && <label className="block"><span className="label">Categories (comma)</span>
                    <input className="input" disabled={readOnly} value={((s.config.values as string[]) ?? []).join(",")} onChange={(e) => setCfg(sel, "values", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></label>}
                  {c.condition === "product" && <label className="block"><span className="label">Product</span>{select(c.value ?? "", (v) => setCfg(sel, "value", v), products.map((p) => [p.id, p.name]))}</label>}
                </>
              )}
              {(s.type === "branch" || s.type === "wait_reply") && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label">{s.type === "wait_reply" ? "On reply, go to step" : "If yes, go to step"}</span><input className="input" type="number" min={1} disabled={readOnly} value={c.then_step ?? ""} onChange={(e) => setCfg(sel, "then_step", Number(e.target.value))} /></label>
                  <label className="block"><span className="label">{s.type === "wait_reply" ? "On timeout, go to step" : "If no, go to step"}</span><input className="input" type="number" min={1} disabled={readOnly} value={c.else_step ?? ""} onChange={(e) => setCfg(sel, "else_step", Number(e.target.value))} /></label>
                </div>
              )}
              {s.type === "task" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="block sm:col-span-3"><span className="label">Task for the lead owner</span><input className="input" disabled={readOnly} value={c.title ?? ""} onChange={(e) => setCfg(sel, "title", e.target.value)} /></label>
                  <label className="block"><span className="label">Due in (hours)</span><input className="input" type="number" min={0} disabled={readOnly} value={c.due_in_hours ?? 4} onChange={(e) => setCfg(sel, "due_in_hours", Number(e.target.value))} /></label>
                  <label className="block"><span className="label">Type</span>{select(c.action_type ?? "call", (v) => setCfg(sel, "action_type", v), ["call", "whatsapp", "meeting", "payment", "email", "other"].map((t) => [t, t]))}</label>
                </div>
              )}
              {s.type === "assign" && (
                <>
                  <label className="block"><span className="label">Assign</span>{select(c.mode ?? "smart", (v) => setCfg(sel, "mode", v), [["smart", "Smart: available agent by rules; backup if owner is away"], ["user", "A specific user"]])}</label>
                  {c.mode === "user" && <label className="block"><span className="label">User</span>{select(c.user_id ?? "", (v) => setCfg(sel, "user_id", v), users.map((u) => [u.id, u.name]))}</label>}
                </>
              )}
              {s.type === "notify" && (
                <>
                  <label className="block"><span className="label">Notify</span>{select(c.target ?? "", (v) => setCfg(sel, "target", v), [["owner", "Lead owner"], ["team_leaders", "Team leaders of the lead's team"], ["admins", "Company admins"], ["user", "A specific user"]], "Choose…")}</label>
                  {c.target === "user" && <label className="block"><span className="label">User</span>{select(c.user_id ?? "", (v) => setCfg(sel, "user_id", v), users.map((u) => [u.id, u.name]))}</label>}
                  <label className="block"><span className="label">Title</span><input className="input" disabled={readOnly} value={c.title ?? ""} onChange={(e) => setCfg(sel, "title", e.target.value)} /></label>
                  <label className="block"><span className="label">Message (optional)</span><input className="input" disabled={readOnly} value={c.body ?? ""} onChange={(e) => setCfg(sel, "body", e.target.value)} /></label>
                </>
              )}
              {s.type === "set_status" && <label className="block"><span className="label">Status category</span>{select(c.category ?? "", (v) => setCfg(sel, "category", v), CATS.map((x) => [x, x.replace("_", " ")]))}</label>}
              {s.type === "tag" && <label className="block"><span className="label">Tag</span>{select(c.tag_id ?? "", (v) => setCfg(sel, "tag_id", v), tags.map((t) => [t.id, t.name]))}</label>}
              {s.type === "ai_summary" && <p className="text-sm text-slate-600">Queues an AI summary of the customer&apos;s chat for the owner (needs AI enabled). Runs as a durable job with retries.</p>}
              {s.type === "end" && <p className="text-sm text-slate-600">The journey completes here.</p>}
              {!["branch", "wait_reply", "end"].includes(s.type) && (
                <label className="flex items-center gap-2 text-xs text-slate-600">Then go to step
                  <input className="input w-16 py-1" type="number" min={1} placeholder={String(sel + 2)} disabled={readOnly} value={s.next_step ?? ""} onChange={(e) => setStep(sel, { next_step: e.target.value ? Number(e.target.value) : null })} />
                  (blank = next)</label>
              )}
            </div>
          )}
        </section>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-navy" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save draft"}</button>
          {d.id && <Link className="btn-primary" href={`/nurture/journeys/${d.id}/preview`}>Preview & publish →</Link>}
          {err && <span role="alert" className="text-sm text-red-600">{err}</span>}
          {ok && <span className="text-sm text-brand-700">{ok}</span>}
          <span className="text-xs text-slate-500">Drafts never run. Publishing creates a new version; running enrolments finish on the version they started.</span>
        </div>
      )}
    </div>
  );
}
