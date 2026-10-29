"use client";
import { useState } from "react";
import { ActionForm, Field, Submit } from "@/components/ui";
import { savePrefs, saveAgent } from "@/lib/actions/wa";
import type { WaPrefs } from "@/lib/wa";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Toggle({ name, defaultChecked, label, hint }: { name: string; defaultChecked: boolean; label: string; hint?: string }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
      <span className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${on ? "bg-navy-800" : "bg-slate-300"}`}><span className={`h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : ""}`} /></span>
      <span className="text-sm"><span className="text-navy-900">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

export function PrefsForm({ p, country, disabled }: { p: WaPrefs; country: string; disabled: boolean }) {
  return (
    <ActionForm action={savePrefs} className="space-y-6">
      <fieldset disabled={disabled} className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-navy-900">Team preferences</h3>
          <Toggle name="pause_bots_when_assigned" defaultChecked={p.pause_bots_when_assigned} label="Pause chatbots while the assigned agent is chatting" hint="Bots stay quiet for 2 hours after an agent replies in an assigned chat; only the away message can still go out of hours." />
          <Field label="Default country" hint="Used for local numbers typed without a country code (contacts, CSV import, send). Two letters, e.g. IN.">
            <input className="input max-w-24 uppercase" name="default_country" defaultValue={country} maxLength={2} />
          </Field>
          <Field label="Away message (optional, sent once per conversation every 12 hours, outside business hours)">
            <textarea className="input" name="away_message" rows={2} defaultValue={p.away_message ?? ""} placeholder="Thanks for reaching out! Our team is offline right now and will reply during business hours." />
          </Field>
        </section>
        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold text-navy-900">Business hours</h3>
          <p className="text-xs text-slate-500">Used by chatbot rules (“only inside / outside hours”) and the away message.</p>
          <Toggle name="hours_enabled" defaultChecked={p.hours_enabled} label="Enable business hours" />
          <div className="grid max-w-md grid-cols-2 gap-3">
            <Field label="From"><input className="input" type="time" name="hours_from" defaultValue={p.hours_from} required /></Field>
            <Field label="To"><input className="input" type="time" name="hours_to" defaultValue={p.hours_to} required /></Field>
          </div>
          <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="hours_days" value={i} defaultChecked={p.hours_days.includes(i)} />{d}</label>
          ))}</div>
          <Field label="Timezone"><input className="input max-w-xs" name="timezone" defaultValue={p.timezone} placeholder="Asia/Kolkata" /></Field>
        </section>
        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold text-navy-900">Opt-out (STOP) handling</h3>
          <p className="text-xs text-slate-500">Meta requires you to honour an opt-out. When a customer replies with one of these keywords they are marked opted-out, marketing templates and campaigns skip them, and the confirmation below is sent. A keyword matches when the whole message is that keyword, or the message starts with it and is five words or fewer.</p>
          <Toggle name="optout_enabled" defaultChecked={p.optout_enabled} label="Honour opt-out and opt-in keywords automatically" />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Opt-out keywords" hint="Comma separated."><textarea className="input" name="optout_keywords" rows={3} defaultValue={p.optout_keywords} /></Field>
            <Field label="Opt-in keywords" hint="Re-subscribes the contact."><textarea className="input" name="optin_keywords" rows={3} defaultValue={p.optin_keywords} /></Field>
            <Field label="Opt-out confirmation"><textarea className="input" name="optout_reply" rows={3} defaultValue={p.optout_reply ?? ""} /></Field>
            <Field label="Opt-in confirmation"><textarea className="input" name="optin_reply" rows={3} defaultValue={p.optin_reply ?? ""} /></Field>
          </div>
          <p className="text-xs text-slate-500">Leave a confirmation empty to apply the change silently. Confirmations go out as normal service replies inside the 24-hour window.</p>
        </section>
        {!disabled && <Submit>Save preferences</Submit>}
      </fieldset>
    </ActionForm>
  );
}

export function AgentRow({ a, open }: { a: { id: string; full_name: string; email: string; role: string; availability: string | null; accepts_auto_allocation: boolean; allocation_limit: number | null }; open: number }) {
  return (
    <ActionForm action={saveAgent} className="grid items-center gap-2 border-b py-3 text-sm last:border-0 md:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
      <input type="hidden" name="id" value={a.id} />
      <div><div className="font-semibold text-navy-900">{a.full_name}</div><div className="text-xs text-slate-500">{a.email} · <span className="rounded bg-slate-100 px-1">{a.role.replace("_", " ")}</span> · {open} open chats</div></div>
      <select name="availability" defaultValue={a.availability ?? "available"} className="input" aria-label="Status"><option value="available">online</option><option value="away">away</option><option value="offline">offline</option></select>
      <label className="flex items-center gap-2"><input type="checkbox" name="accepts_auto_allocation" defaultChecked={a.accepts_auto_allocation} /> Auto-assign</label>
      <input name="allocation_limit" type="number" min={1} max={500} defaultValue={a.allocation_limit ?? ""} placeholder="Max open" className="input" aria-label="Max open leads" />
      <Submit className="btn-navy btn-sm">Save</Submit>
    </ActionForm>
  );
}
