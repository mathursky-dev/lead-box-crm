"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDrip } from "@/lib/actions/nurture";
import { dripIssues, MAX_DRIP_DAY, MAX_DRIP_MESSAGES, type DripDraft, type DripMessage } from "@/lib/drip";

type Tpl = { name: string; language: string; category: string; body: string };
const TOKENS = "Use {{name}} or {{first_name}} for the customer's name.";

export function DripBuilder({ initial, active, statuses, sources, numbers, templates }: {
  initial: DripDraft; active: boolean; statuses: { id: string; name: string; category: string }[]; sources: { id: string; name: string }[];
  numbers: { id: string; name: string }[]; templates: Tpl[];
}) {
  const [d, setD] = useState<DripDraft>(initial);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (p: Partial<DripDraft>) => setD((x) => ({ ...x, ...p }));
  const setMsgAt = (i: number, p: Partial<DripMessage>) => setD((x) => ({ ...x, messages: x.messages.map((m, k) => (k === i ? { ...m, ...p } : m)) }));
  const issues = dripIssues(d);
  const tplKey = (m: DripMessage) => (m.template_name ? `${m.template_name}|${m.template_language}` : "");

  const save = (publish: boolean) => start(async () => {
    const r = await saveDrip(d, publish);
    setMsg(r);
    if (!r.error && r.id) {
      if (!d.id) { router.replace(`/nurture/drip/${r.id}`); return; }
      router.refresh();
    }
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-navy-900">1. When does it start?</h2>
          <label className="block"><span className="label">Drip name</span>
            <input className="input" maxLength={80} placeholder="e.g. Interested leads – 7 day follow-up" value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Start when</span>
              <select className="input" value={d.trigger} onChange={(e) => set({ trigger: e.target.value as DripDraft["trigger"] })}>
                <option value="status">Lead moves to a status</option><option value="lead_created">A new lead is created</option>
              </select></label>
            {d.trigger === "status" && (
              <label className="block"><span className="label">Status</span>
                <select className="input" value={d.status_id} onChange={(e) => { const s = statuses.find((x) => x.id === e.target.value); set({ status_id: e.target.value, category: s?.category ?? "" }); }}>
                  <option value="">Choose…</option>{statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></label>
            )}
            <label className="block"><span className="label">Only leads from source (optional)</span>
              <select className="input" value={d.source_id} onChange={(e) => set({ source_id: e.target.value })}>
                <option value="">Any source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
            <label className="block"><span className="label">Send from number</span>
              <select className="input" value={d.number_id} onChange={(e) => set({ number_id: e.target.value })}>
                <option value="">Lead&apos;s own / default number</option>{numbers.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select></label>
          </div>
          <div className="space-y-1.5 text-sm">
            {d.trigger === "status" && (
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={d.stop_on_status_change} onChange={(e) => set({ stop_on_status_change: e.target.checked })} />
                <span>Stop when the lead moves to another status</span></label>
            )}
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={d.pause_on_reply} onChange={(e) => set({ pause_on_reply: e.target.checked })} />
              <span>Pause when the customer replies (your team takes over the chat)</span></label>
            <p className="text-xs text-slate-500">Always stops when the lead is won, lost or raises a complaint.</p>
          </div>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-navy-900">2. Messages, day by day</h2>
          <p className="text-xs text-slate-500">Day 0 = the moment the drip starts. Day 1 = one day later, and so on. Business-initiated WhatsApp messages must use an approved template.</p>
          {d.messages.map((m, i) => {
            const tpl = templates.find((t) => t.name === m.template_name && t.language === m.template_language);
            const n = tpl ? new Set(tpl.body.match(/\{\{\d+\}\}/g) ?? []).size : 0;
            return (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block w-24"><span className="label">Day</span>
                    <input className="input" type="number" min={0} max={MAX_DRIP_DAY} value={Number.isFinite(m.day) ? m.day : ""}
                      onChange={(e) => setMsgAt(i, { day: e.target.value === "" ? NaN : Math.floor(Number(e.target.value)) })} /></label>
                  <label className="block min-w-[200px] flex-1"><span className="label">Template</span>
                    <select className="input" value={tplKey(m)} onChange={(e) => { const [a, b] = e.target.value.split("|"); setMsgAt(i, { template_name: a ?? "", template_language: b ?? "", params: [] }); }}>
                      <option value="">{templates.length ? "Choose an approved template…" : "No approved templates yet"}</option>
                      {templates.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}){t.category ? ` · ${t.category.toLowerCase()}` : ""}</option>)}
                    </select></label>
                  <button type="button" className="btn-ghost btn-sm text-red-700" disabled={d.messages.length <= 1}
                    onClick={() => set({ messages: d.messages.filter((_, k) => k !== i) })}>Remove</button>
                </div>
                {tpl && <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">{tpl.body}</p>}
                {n > 0 && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {Array.from({ length: n }).map((_, k) => (
                      <input key={k} className="input" placeholder={`{{${k + 1}}} value, e.g. {{name}}`} value={m.params[k] ?? ""}
                        onChange={(e) => { const p = [...m.params]; p[k] = e.target.value; setMsgAt(i, { params: p }); }} />
                    ))}
                    <p className="text-xs text-slate-400 sm:col-span-2">{TOKENS}</p>
                  </div>
                )}
              </div>
            );
          })}
          {d.messages.length < MAX_DRIP_MESSAGES && (
            <button type="button" className="btn-ghost btn-sm"
              onClick={() => { const last = d.messages[d.messages.length - 1]?.day; set({ messages: [...d.messages, { day: Number.isFinite(last) ? last + 2 : 0, template_name: "", template_language: "", params: [] }] }); }}>
              + Add message
            </button>
          )}
          <label className="block"><span className="label">After the last message, create a task for the lead owner (optional)</span>
            <input className="input" maxLength={200} placeholder="Leave empty for no task" value={d.final_task} onChange={(e) => set({ final_task: e.target.value })} /></label>
        </section>
      </div>

      <aside className="space-y-3">
        <section className="card space-y-2 p-4 lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold text-navy-900">Summary</h2>
          <ol className="space-y-1 text-sm text-slate-700">
            <li>▶ {d.trigger === "status" ? `Lead moves to ${statuses.find((s) => s.id === d.status_id)?.name ?? "…"}` : "New lead is created"}</li>
            {d.messages.map((m, i) => <li key={i}>✉ Day {Number.isFinite(m.day) ? m.day : "?"}: {m.template_name || "choose template"}</li>)}
            {d.final_task.trim() && <li>☑ Task: {d.final_task}</li>}
          </ol>
          {issues.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
          {msg?.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg.error}</div>}
          {msg?.ok && <div role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{msg.ok}</div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-primary" disabled={pending || issues.length > 0} onClick={() => save(true)}>{active ? "Save changes" : "Save & switch on"}</button>
            {!active && <button type="button" className="btn-ghost" disabled={pending || issues.length > 0} onClick={() => save(false)}>Save as draft</button>}
          </div>
          <p className="text-xs text-slate-500">Only leads that start the drip after you switch it on get it. Running leads finish on the version they started with.</p>
        </section>
      </aside>
    </div>
  );
}
