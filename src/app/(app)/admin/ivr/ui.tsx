"use client";
import { useState, useTransition } from "react";
import { ActionForm, Field, Submit } from "@/components/ui";
import { saveIvrSettings, setIvrPhone } from "@/lib/actions/ivr";
import { IVR_PROVIDERS_UI } from "./providers";

type S = { provider: string; enabled: boolean; record: boolean; account_sid: string; api_host: string; api_key: string; caller_id: string; has_token: boolean };

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex gap-2">
      <input className="input font-mono text-xs" readOnly value={value} onFocus={(e) => e.target.select()} />
      <button type="button" className="btn-ghost btn-sm" onClick={async () => { await navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? "Copied" : "Copy"}</button>
    </div>
  );
}

function AgentRow({ u }: { u: { id: string; name: string; phone: string; ivr_phone: string } }) {
  const [v, setV] = useState(u.ivr_phone || "");
  const [msg, setMsg] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <tr>
      <td className="td">{u.name}</td>
      <td className="td text-slate-500">{u.phone || "—"}</td>
      <td className="td">
        <div className="flex items-center gap-2">
          <input className="input !w-44 !py-1" value={v} onChange={(e) => setV(e.target.value)} placeholder={u.phone || "+91…"} aria-label={`Calling mobile of ${u.name}`} />
          <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => { const r = await setIvrPhone(u.id, v); setMsg(r?.error ?? r?.ok); })}>{pending ? "…" : "Save"}</button>
          {msg && <span className={`text-xs ${msg === "Saved." ? "text-brand-700" : "text-red-600"}`}>{msg}</span>}
        </div>
      </td>
    </tr>
  );
}

export function IvrForms({ s, hookUrl, users }: { s: S | null; hookUrl: string | null; users: { id: string; name: string; phone: string; ivr_phone: string }[] }) {
  const [provider, setProvider] = useState(s?.provider ?? "exotel");
  const p = IVR_PROVIDERS_UI[provider as keyof typeof IVR_PROVIDERS_UI];
  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold text-navy-900">Provider</h2>
        <ActionForm action={saveIvrSettings} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(IVR_PROVIDERS_UI).map(([k, x]) => (
              <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${provider === k ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}>
                <input type="radio" name="provider" value={k} checked={provider === k} onChange={() => setProvider(k)} /> {x.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">{p.help}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {provider === "exotel" && <Field label="Account SID"><input className="input" name="account_sid" required defaultValue={s?.account_sid} autoComplete="off" /></Field>}
            {provider === "exotel" && <Field label="API host" hint="Mumbai cluster: api.in.exotel.com · Singapore: api.exotel.com"><input className="input" name="api_host" defaultValue={s?.api_host || "api.exotel.com"} /></Field>}
            <Field label={p.key}><input className="input" name="api_key" required defaultValue={s?.api_key} autoComplete="off" /></Field>
            <Field label={p.token}><input className="input" name="api_token" type="password" autoComplete="new-password" placeholder={s?.has_token ? "•••••• (saved, leave empty to keep)" : ""} /></Field>
            <Field label={p.number}><input className="input" name="caller_id" required defaultValue={s?.caller_id} placeholder="+91 80 4XXX XXXX" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="record" defaultChecked={s?.record ?? true} /> Record calls (recordings are saved on the lead; turn off under Calls → Recordings too)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? false} /> Cloud calling is <b>on</b> (shows “IVR call” on every lead)</label>
          <Submit pendingText="Checking keys…">Save</Submit>
        </ActionForm>
      </section>

      {hookUrl && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold text-navy-900">Call events URL</h2>
          <p className="text-sm text-slate-600">{p.hook}</p>
          <Copy value={hookUrl} />
          <p className="text-xs text-slate-500">Keep this URL private. Click-to-call calls send it automatically.</p>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="p-4 pb-2">
          <h2 className="font-semibold text-navy-900">Agents&apos; calling mobile</h2>
          <p className="text-sm text-slate-500">The number the provider rings first when this user clicks “IVR call”, and how incoming IVR calls are matched to a user. Empty = their profile mobile.</p>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="td">User</th><th className="td">Profile mobile</th><th className="td">Calling mobile</th></tr></thead>
          <tbody>{users.map((u) => <AgentRow key={u.id} u={u} />)}</tbody>
        </table>
      </section>
    </div>
  );
}
