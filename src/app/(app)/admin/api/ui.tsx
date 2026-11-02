"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Modal, Submit } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { createApiKey, revokeApiKey, saveWebhook, deleteWebhook, testWebhook, revealWebhookSecret } from "@/lib/actions/connectors";
import { IconAction, useAct } from "../../settings/ui";

export type KeyRow = { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null; expires_at: string | null };
export type HookRow = { id: string; name: string; url: string; events: string[]; is_active: boolean; last_status: number | null; last_error: string | null; last_sent_at: string | null; created_at: string };
export type DeliveryRow = { id: number; webhook_id: string; event: string; status: string; attempts: number; response_code: number | null; error: string | null; created_at: string; sent_at: string | null };

const EVENTS: [string, string][] = [["lead.created", "Lead created"], ["lead.status_changed", "Status changed"], ["lead.assigned", "Lead assigned"]];
const SCOPES: [string, string][] = [["leads.write", "Create leads"], ["leads.read", "Read leads"], ["leads.update", "Update leads"]];
const EXPIRY: [number, string][] = [[0, "Never"], [30, "30 days"], [90, "90 days"], [180, "6 months"], [365, "1 year"]];

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>{done ? "Copied" : "Copy"}</button>;
}

export function ApiAdmin({ origin, keys, hooks, deliveries }: { origin: string; keys: KeyRow[]; hooks: HookRow[]; deliveries: DeliveryRow[] }) {
  const act = useAct();
  const [newKey, setNewKey] = useState(false);
  const [hook, setHook] = useState<HookRow | "new" | null>(null);
  const hookName = new Map(hooks.map((h) => [h.id, h.name]));
  return (
    <div className="space-y-5">
      {act.banner && <div className="card overflow-hidden">{act.banner}</div>}

      <section className="card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 p-4 pb-3">
          <h2 className="text-sm font-semibold text-navy-900">API keys</h2>
          <button type="button" className="btn-primary btn-sm ml-auto" onClick={() => setNewKey(true)}>+ New API key</button>
        </div>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">Name</th><th className="th">Key</th><th className="th">Permissions</th><th className="th">Last used</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
          <tbody className="divide-y">
            {keys.length === 0 && <tr><td className="td text-slate-500" colSpan={6}>No API keys yet.</td></tr>}
            {keys.map((k) => (
              <tr key={k.id} className={k.revoked_at ? "text-slate-400" : ""}>
                <td className="td font-medium">{k.name}<div className="text-xs font-normal text-slate-500">created {fmtDateTime(k.created_at)}</div></td>
                <td className="td font-mono text-xs">{k.prefix}…</td>
                <td className="td text-xs">{k.scopes.map((s) => SCOPES.find(([v]) => v === s)?.[1] ?? s).join(", ")}</td>
                <td className="td text-xs">{k.last_used_at ? fmtDateTime(k.last_used_at) : "Never"}</td>
                <td className="td">{(() => {
                  const expired = !k.revoked_at && !!k.expires_at && new Date(k.expires_at).getTime() <= Date.now();
                  return <>
                    <span className={`badge ${k.revoked_at || expired ? "bg-slate-100 text-slate-600" : "bg-brand-50 text-brand-700"}`}>{k.revoked_at ? "Revoked" : expired ? "Expired" : "Active"}</span>
                    {!k.revoked_at && k.expires_at && !expired && <div className="mt-0.5 text-[11px] text-slate-500">till {fmtDateTime(k.expires_at)}</div>}
                  </>;
                })()}</td>
                <td className="td text-right">{!k.revoked_at && <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => act.run(() => revokeApiKey(k.id), `Revoke "${k.name}"? Apps using this key stop working right away.`)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 p-4 pb-3">
          <h2 className="text-sm font-semibold text-navy-900">Outgoing webhooks</h2>
          <span className="text-xs text-slate-500">We POST to your URL when something happens to a lead.</span>
          <button type="button" className="btn-primary btn-sm ml-auto" onClick={() => setHook("new")}>+ Add webhook</button>
        </div>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">Name / URL</th><th className="th">Events</th><th className="th">Last call</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
          <tbody className="divide-y">
            {hooks.length === 0 && <tr><td className="td text-slate-500" colSpan={5}>No webhooks yet.</td></tr>}
            {hooks.map((h) => (
              <tr key={h.id} className={h.is_active ? "" : "text-slate-400"}>
                <td className="td"><div className="font-medium">{h.name}</div><div className="max-w-xs truncate font-mono text-xs text-slate-500" title={h.url}>{h.url}</div></td>
                <td className="td text-xs">{h.events.map((e) => EVENTS.find(([v]) => v === e)?.[1] ?? e).join(", ")}</td>
                <td className="td text-xs">{h.last_sent_at ? <>{fmtDateTime(h.last_sent_at)} · {h.last_error ? <span className="text-red-600">{h.last_error}</span> : `HTTP ${h.last_status}`}</> : "Never"}</td>
                <td className="td"><span className={`badge ${h.is_active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{h.is_active ? "On" : "Off"}</span></td>
                <td className="td"><span className="flex justify-end gap-1.5">
                  <button type="button" className="btn-ghost btn-sm" disabled={act.pending} onClick={() => act.run(() => testWebhook(h.id))}>Send test</button>
                  <SecretButton id={h.id} />
                  <IconAction icon="pencil" label={`Edit ${h.name}`} onClick={() => setHook(h)} />
                  <IconAction icon="trash" tone="red" label={`Delete ${h.name}`} onClick={() => act.run(() => deleteWebhook(h.id), `Delete webhook "${h.name}"?`)} />
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {deliveries.length > 0 && (
          <details className="border-t border-slate-200 p-4 text-sm">
            <summary className="cursor-pointer font-medium text-brand-700">Recent calls ({deliveries.length})</summary>
            <table className="mt-2 w-full min-w-[600px] text-xs">
              <thead><tr className="text-left text-slate-500"><th className="py-1">When</th><th>Webhook</th><th>Event</th><th>Result</th><th>Tries</th></tr></thead>
              <tbody className="divide-y">{deliveries.map((d) => (
                <tr key={d.id}><td className="py-1">{fmtDateTime(d.created_at)}</td><td>{hookName.get(d.webhook_id) ?? "—"}</td><td className="font-mono">{d.event}</td>
                  <td className={d.status === "sent" ? "text-brand-700" : d.status === "failed" ? "text-red-600" : "text-amber-700"}>{d.status}{d.response_code ? ` · HTTP ${d.response_code}` : ""}{d.error ? ` · ${d.error}` : ""}</td><td>{d.attempts}</td></tr>
              ))}</tbody>
            </table>
          </details>
        )}
      </section>

      <ApiDocs origin={origin} />

      <Modal open={newKey} onClose={() => setNewKey(false)} title="New API key"><NewKey onClose={() => setNewKey(false)} /></Modal>
      <Modal open={hook !== null} onClose={() => setHook(null)} title={hook && hook !== "new" ? `Edit ${hook.name}` : "Add webhook"}>
        {hook !== null && (
          <ActionForm action={saveWebhook} onOk={() => setHook(null)} className="space-y-3">
            {hook !== "new" && <input type="hidden" name="id" value={hook.id} />}
            <label className="block"><span className="label">Name</span><input className="input" name="name" required maxLength={80} defaultValue={hook === "new" ? "My software" : hook.name} /></label>
            <label className="block"><span className="label">URL (https)</span><input className="input font-mono" name="url" type="url" required placeholder="https://example.com/leadbox-hook" defaultValue={hook === "new" ? "" : hook.url} /></label>
            <fieldset><legend className="label">Events</legend>
              <div className="flex flex-wrap gap-4">{EVENTS.map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" name="events" value={v} defaultChecked={hook === "new" ? v === "lead.created" : hook.events.includes(v)} /> {l}</label>
              ))}</div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={hook === "new" ? true : hook.is_active} /> On</label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setHook(null)}>Cancel</button><Submit>Save</Submit></div>
          </ActionForm>
        )}
      </Modal>
    </div>
  );
}

function SecretButton({ id }: { id: string }) {
  const [secret, setSecret] = useState<string>();
  const [pending, start] = useTransition();
  if (secret) return <span className="flex items-center gap-1"><code className="max-w-40 truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs" title={secret}>{secret}</code><Copy text={secret} /></span>;
  return <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => { const r = await revealWebhookSecret(id); setSecret(r.secret ?? r.error); })}>Signing secret</button>;
}

function NewKey({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("Website");
  const [scopes, setScopes] = useState<string[]>(["leads.write"]);
  const [expires, setExpires] = useState(0);
  const [res, setRes] = useState<{ error?: string; key?: string }>();
  const [pending, start] = useTransition();
  const router = useRouter();
  if (res?.key) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium text-navy-900">Copy this key now. For safety it is shown only once.</p>
        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1.5 font-mono text-xs">{res.key}</code><Copy text={res.key} /></div>
        <div className="flex justify-end"><button type="button" className="btn-primary" onClick={() => { onClose(); router.refresh(); }}>Done</button></div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <label className="block"><span className="label">Name (where you will use it)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <fieldset><legend className="label">Permissions</legend>
        <div className="flex flex-wrap gap-4">{SCOPES.map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scopes.includes(v)} onChange={(e) => setScopes((s) => (e.target.checked ? [...s, v] : s.filter((x) => x !== v)))} /> {l}</label>
        ))}</div>
      </fieldset>
      <label className="block"><span className="label">Expires</span>
        <select className="input w-40" value={expires} onChange={(e) => setExpires(Number(e.target.value))}>{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      {res?.error && <p role="alert" className="text-sm text-red-600">{res.error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={pending} onClick={() => start(async () => setRes(await createApiKey(name, scopes, expires)))}>{pending ? "Creating…" : "Create key"}</button></div>
    </div>
  );
}

const Block = ({ title, code, children }: { title: string; code: string; children?: React.ReactNode }) => (
  <div>
    <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-navy-900">{title}</h3><span className="ml-auto"><Copy text={code} /></span></div>
    {children && <div className="mt-1 text-xs text-slate-600">{children}</div>}
    <pre className="mt-1 overflow-x-auto rounded-lg bg-navy-900 p-3 text-xs text-slate-100"><code>{code}</code></pre>
  </div>
);

function ApiDocs({ origin }: { origin: string }) {
  const create = `curl -X POST ${origin}/api/v1/leads \\
  -H "Authorization: Bearer lbk_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Rahul Sharma","phone":"9876543210","email":"rahul@example.com","city":"Jaipur","source":"Website","product":"","tags":["Hot"],"notes":"Wants a demo"}'`;
  const list = `curl "${origin}/api/v1/leads?since=2026-11-01T00:00:00Z&limit=50" -H "Authorization: Bearer lbk_YOUR_KEY"`;
  const verify = `// Node.js: check X-LeadBox-Signature
const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(req.headers["x-leadbox-timestamp"] + "." + rawBody).digest("hex");
if (sig !== req.headers["x-leadbox-signature"]) return res.status(401).end();`;
  return (
    <section className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-navy-900">API guide</h2>
        <a href="/developers" target="_blank" rel="noopener" className="btn-ghost btn-sm ml-auto">Full API docs (share with your developer) ↗</a>
      </div>
      <p className="text-xs text-slate-600">Base URL <code className="rounded bg-slate-100 px-1">{origin}/api/v1</code> · send the key as <code className="rounded bg-slate-100 px-1">Authorization: Bearer lbk_…</code> (or <code className="rounded bg-slate-100 px-1">X-Api-Key</code>) · 120 requests per minute per key · JSON in and out.</p>
      <Block title="Create a lead: POST /leads" code={create}>
        Only <b>phone</b> is required (Indian numbers may skip +91). <b>source</b> is matched by name (made if new, default “API”); <b>product</b> and <b>tags</b> by name; <b>custom</b> takes your custom field keys.
        If the number already has an open lead, nothing new is made: the details are added to that lead and you get <code>status: &quot;duplicate&quot;</code>.
      </Block>
      <Block title="List leads: GET /leads" code={list}>Newest first. Filters: <code>since</code> (updated after, ISO time), <code>phone</code>, <code>status</code> (new, contacted, interested, follow_up, won, lost…), <code>limit</code> (max 200), <code>offset</code>.</Block>
      <Block title="Check a key: GET /me" code={`curl ${origin}/api/v1/me -H "Authorization: Bearer lbk_YOUR_KEY"`} />
      <Block title="Webhook calls we send" code={`POST https://your-url
X-LeadBox-Event: lead.created
X-LeadBox-Timestamp: 1767225600
X-LeadBox-Signature: sha256=…

{"event":"lead.created","sent_at":"…","lead":{"id":"…","lead_no":1234,"name":"Rahul","phone":"+919876543210","source":"Website","status":"New","status_category":"new","owner":"Amit", …}}`}>
        Answer with any 2xx within 10 seconds. Failed calls are retried 5 more times (1, 5, 15, 60, 180 minutes).
      </Block>
      <Block title="Verify the signature" code={verify} />
    </section>
  );
}
