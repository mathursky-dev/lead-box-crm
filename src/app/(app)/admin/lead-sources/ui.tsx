"use client";
import { useState, useTransition } from "react";
import { ActionForm, Modal, Submit } from "@/components/ui";
import { Icon } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { saveConnector, deleteConnector, regenerateConnectorToken, testConnector } from "@/lib/actions/connectors";
import type { TestResult } from "@/lib/actions/facebook";
import { WIDGET_DEFAULTS, type WidgetConfig } from "@/lib/widget";
import { IconAction, useAct } from "../../settings/ui";

type Kind = "google" | "indiamart" | "justdial" | "widget" | "webhook";
export type ConnRow = {
  id: string; kind: Kind; name: string; token: string; source_id: string | null; product_id: string | null; department_id: string | null; tag_id: string | null;
  config: Record<string, unknown>; is_active: boolean; leads_count: number; duplicate_count: number; last_lead_at: string | null; last_sync_at: string | null;
  last_error: string | null; last_error_at: string | null; created_at: string; has_secret: boolean; google_key: string | null;
};
type Opt = { id: string; name: string };
type Refs = { sources: Opt[]; products: Opt[]; departments: Opt[]; tags: Opt[] };

const KINDS: { kind: Kind; title: string; badge: string; color: string; blurb: string; steps: string[] }[] = [
  { kind: "google", title: "Google Ads lead forms", badge: "G", color: "bg-[#4285F4]", blurb: "Leads from Google Ads lead form assets (Search, YouTube, Discovery).",
    steps: ["Google Ads → Assets → Lead form → open your form.", "Lead delivery option → Webhook integration.", "Paste the Webhook URL and the Key shown here.", "Click “Send test data”: a test lead shows up in Leads."] },
  { kind: "indiamart", title: "IndiaMART", badge: "IM", color: "bg-[#2E3192]", blurb: "Enquiries, buy leads and PNS calls from your IndiaMART seller account.",
    steps: ["Option 1 (instant): IndiaMART Lead Manager → Settings → Import/Export leads → Push API, paste the Push URL.",
      "Option 2 (every 10 min): Lead Manager → Settings → Import/Export leads → CRM Integration → generate the CRM key, paste it here.",
      "You can use both; the same enquiry never makes two leads."] },
  { kind: "justdial", title: "JustDial", badge: "JD", color: "bg-[#FF6F00]", blurb: "Leads from your JustDial listing.",
    steps: ["Send the Lead URL to your JustDial account manager (or support) and ask them to push leads to it.", "They can use GET or POST; we answer RECEIVED.", "Ask them to send one test lead and check Leads."] },
  { kind: "widget", title: "Website chat widget", badge: "💬", color: "bg-[#25D366]", blurb: "A WhatsApp chat button on your website. Visitor leaves name + mobile, the lead comes here and WhatsApp opens.",
    steps: ["Set your WhatsApp number and texts.", "Copy the embed code and paste it before </body> on your website (WordPress: Header/Footer plugin, Wix/Shopify: custom code).", "Open your website, click the green button and send a test."] },
  { kind: "webhook", title: "Other software (webhook)", badge: "{ }", color: "bg-slate-700", blurb: "Zapier, Pabbly, Make, your website backend, Typeform… anything that can POST.",
    steps: ["POST JSON or form data to the URL.", "Fields we read: name, phone (or mobile), email, city, message. Everything else is kept in the lead notes.", "For full control (read leads, set source/tags) use the REST API with an API key."] },
];

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>{done ? "Copied" : label}</button>;
}
const CodeLine = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <div className="text-xs font-semibold text-slate-500">{label}</div>
    <div className="mt-0.5 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 font-mono text-xs text-navy-900" title={value}>{value}</code><Copy text={value} /></div>
  </div>
);

function TestBox({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<TestResult>();
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => setRes(await testConnector(id)))}>{pending ? "Testing…" : "Test"}</button>
      {res && (
        <div role="status" className="mt-2 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <button type="button" className="float-right text-slate-400 hover:text-slate-700" onClick={() => setRes(undefined)} aria-label="Close">✕</button>
          {res.error ? <p className="text-red-700">{res.error}</p> : (
            <ul className="space-y-1">{res.checks?.map(([l, ok, d]) => (
              <li key={l} className="flex gap-2"><span className={ok ? "text-brand-600" : "text-red-600"}>{ok ? "✓" : "✗"}</span><span><b className="font-medium text-navy-900">{l}</b><span className="block text-xs text-slate-500">{d}</span></span></li>
            ))}</ul>
          )}
        </div>
      )}
    </>
  );
}

export function LeadSources({ rows, origin, refs, initialKind, defaultWa }: { rows: ConnRow[]; origin: string; refs: Refs; initialKind?: string; defaultWa: string }) {
  const [edit, setEdit] = useState<{ kind: Kind; row?: ConnRow } | null>(null);
  const act = useAct();
  const order = initialKind ? [...KINDS].sort((a, b) => (a.kind === initialKind ? -1 : b.kind === initialKind ? 1 : 0)) : KINDS;
  const refName = (l: Opt[], id: string | null) => l.find((x) => x.id === id)?.name;

  return (
    <div className="space-y-5">
      {act.banner && <div className="card overflow-hidden">{act.banner}</div>}
      {order.map((k) => {
        const list = rows.filter((r) => r.kind === k.kind);
        return (
          <section key={k.kind} id={k.kind} className="card p-4">
            <div className="flex flex-wrap items-start gap-3">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white ${k.color}`} aria-hidden>{k.badge}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-navy-900">{k.title}</h2>
                <p className="text-sm text-slate-500">{k.blurb}</p>
              </div>
              <button type="button" className="btn-primary btn-sm" onClick={() => setEdit({ kind: k.kind })}>+ {list.length ? "Add another" : "Connect"}</button>
            </div>
            <details className="mt-3 text-sm text-slate-600" open={list.length === 0 && initialKind === k.kind}>
              <summary className="cursor-pointer font-medium text-brand-700">How to set up</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">{k.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </details>
            {list.map((c) => {
              const url = `${origin}/api/hooks/${c.kind}/${c.token}`;
              return (
                <div key={c.id} className={`mt-3 rounded-lg border p-3 ${c.is_active ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy-900">{c.name}</span>
                    <span className={`badge ${c.is_active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{c.is_active ? "Live" : "Paused"}</span>
                    <span className="text-xs text-slate-500">
                      {c.leads_count} new · {c.duplicate_count} repeat{c.last_lead_at ? ` · last lead ${fmtDateTime(c.last_lead_at)}` : " · no lead yet"}
                      {refName(refs.sources, c.source_id) ? ` · source ${refName(refs.sources, c.source_id)}` : ""}
                    </span>
                    <span className="ml-auto flex flex-wrap justify-end gap-1.5">
                      <TestBox id={c.id} />
                      <IconAction icon="pencil" label={`Edit ${c.name}`} onClick={() => setEdit({ kind: c.kind, row: c })} />
                      <IconAction icon="trash" tone="red" label={`Delete ${c.name}`} onClick={() => act.run(() => deleteConnector(c.id), `Delete "${c.name}"? Its URL stops working. Leads already received stay.`)} />
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {c.kind === "widget" ? (
                      <CodeLine label="Embed code (paste before </body>)" value={`<script src="${origin}/api/widget/${c.token}" async></script>`} />
                    ) : <CodeLine label={c.kind === "indiamart" ? "Push URL" : c.kind === "justdial" ? "Lead URL" : "Webhook URL"} value={url} />}
                    {c.kind === "google" && c.google_key && <CodeLine label="Key (paste in Google Ads)" value={c.google_key} />}
                    {c.kind === "indiamart" && <div className="text-xs text-slate-500"><div className="font-semibold">CRM key (pull)</div>{c.has_secret ? `Saved ✓ · last check ${c.last_sync_at ? fmtDateTime(c.last_sync_at) : "pending"}` : "Not added (push URL only)"}</div>}
                    {c.kind === "widget" && <div className="text-xs text-slate-500"><div className="font-semibold">WhatsApp number</div>+{String((c.config as WidgetConfig).wa_number)} · asks name + mobile: {(c.config as WidgetConfig).ask_details ? "yes" : "no"}</div>}
                    {c.kind === "webhook" && <CodeLine label="Test with curl" value={`curl -X POST ${url} -H "Content-Type: application/json" -d '{"name":"Test","phone":"9876543210","city":"Jaipur","message":"Hi"}'`} />}
                  </div>
                  {c.last_error && <p className="mt-2 text-xs text-red-600">Last problem{c.last_error_at ? ` (${fmtDateTime(c.last_error_at)})` : ""}: {c.last_error}</p>}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <button type="button" className="text-slate-500 hover:text-navy-900 hover:underline" onClick={() => act.run(() => regenerateConnectorToken(c.id), "Make a new URL? The old URL stops working right away and must be updated in the other software.")}>New URL</button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.row ? `Edit ${edit.row.name}` : `Connect ${KINDS.find((k) => k.kind === edit?.kind)?.title ?? ""}`} wide={edit?.kind === "widget"}>
        {edit && <Editor kind={edit.kind} row={edit.row} refs={refs} defaultWa={defaultWa} onDone={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}

const Sel = ({ name, label, list, value, hint }: { name: string; label: string; list: Opt[]; value: string | null | undefined; hint?: string }) => (
  <label className="block"><span className="label">{label}</span>
    <select className="input" name={name} defaultValue={value ?? ""}><option value="">{hint ?? "—"}</option>{list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
  </label>
);

function Editor({ kind, row, refs, defaultWa, onDone }: { kind: Kind; row?: ConnRow; refs: Refs; defaultWa: string; onDone: () => void }) {
  const title = KINDS.find((k) => k.kind === kind)!.title;
  const w = (row?.config as WidgetConfig | undefined) ?? { ...WIDGET_DEFAULTS, wa_number: defaultWa };
  const [color, setColor] = useState(w.color);
  const defSource = { google: "Google Ads", indiamart: "IndiaMART", justdial: "JustDial", widget: "Website Chat", webhook: "Webhook" }[kind];
  return (
    <ActionForm action={saveConnector} onOk={onDone} className="space-y-3">
      {row && <input type="hidden" name="id" value={row.id} />}
      <input type="hidden" name="kind" value={kind} />
      <label className="block"><span className="label">Name</span><input className="input" name="name" required maxLength={120} defaultValue={row?.name ?? title} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Sel name="source_id" label="Lead source" list={refs.sources} value={row?.source_id} hint={`${defSource} (auto)`} />
        <Sel name="product_id" label="Product (optional)" list={refs.products} value={row?.product_id} />
        <Sel name="department_id" label="Department (optional)" list={refs.departments} value={row?.department_id} />
        <Sel name="tag_id" label="Tag (optional)" list={refs.tags} value={row?.tag_id} />
      </div>
      {kind === "indiamart" && (
        <label className="block"><span className="label">IndiaMART CRM key (optional)</span>
          <input className="input font-mono" name="secret" autoComplete="off" maxLength={200} placeholder={row?.has_secret ? "Saved. Leave empty to keep it" : "Paste the CRM key to also pull leads every 10 minutes"} />
          <span className="mt-1 block text-xs text-slate-500">IndiaMART allows one pull per 5 minutes per key, so press Test only once in a while.</span>
        </label>
      )}
      {kind === "widget" && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">WhatsApp number (with country code)</span><input className="input" name="wa_number" required inputMode="numeric" placeholder="919876543210" defaultValue={w.wa_number} /></label>
            <label className="block"><span className="label">Button text</span><input className="input" name="button_text" maxLength={40} defaultValue={w.button_text} /></label>
            <label className="block"><span className="label">Title</span><input className="input" name="title" maxLength={60} defaultValue={w.title} /></label>
            <label className="block"><span className="label">Subtitle</span><input className="input" name="subtitle" maxLength={100} defaultValue={w.subtitle} /></label>
          </div>
          <label className="block"><span className="label">Greeting</span><input className="input" name="greeting" maxLength={300} defaultValue={w.greeting} /></label>
          <label className="block"><span className="label">Pre-filled WhatsApp message</span><input className="input" name="message" maxLength={300} defaultValue={w.message} /></label>
          <label className="block"><span className="label">Thank-you text</span><input className="input" name="thank_you" maxLength={200} defaultValue={w.thank_you} /></label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block"><span className="label">Colour</span><input type="color" name="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 rounded border border-slate-200" /></label>
            <label className="block"><span className="label">Position</span><select className="input" name="position" defaultValue={w.position}><option value="right">Bottom right</option><option value="left">Bottom left</option></select></label>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="ask_details" defaultChecked={w.ask_details} /> Ask name + mobile first (creates the lead)</label>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <span className="grid h-12 w-12 place-items-center rounded-full text-white shadow" style={{ background: color }}><Icon name="chat" className="h-6 w-6" /></span>
            Preview of the button. Without “Ask name + mobile” the visitor goes straight to WhatsApp and the lead is made when their message arrives.
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={row?.is_active ?? true} /> Live (receive leads)</label>
      <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-ghost" onClick={onDone}>Cancel</button><Submit>Save</Submit></div>
    </ActionForm>
  );
}
