"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { Field } from "@/components/ui";
import { getBroadcastRefs, previewBroadcast, sendBroadcast, type Audience, type BroadcastRefs, type Preview } from "@/lib/actions/broadcast";

const REASON: Record<string, string> = { no_consent: "no opt-in", opted_out: "opted out", suppressed: "suppressed" };

/**
 * WhatsApp template broadcast to an audience (picked leads, or filter rules).
 * Creates a campaign through lb_broadcast; send-time guards (opt-in, opt-out,
 * suppression, weekly cap, quiet hours) are applied by the campaign runner.
 */
export function BroadcastForm({ audience, defaultName, onDone }: { audience: Audience; defaultName?: string; onDone?: () => void }) {
  const router = useRouter();
  const [refs, setRefs] = useState<BroadcastRefs | null>(null);
  const [refErr, setRefErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [num, setNum] = useState("");
  const [tpl, setTpl] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [name, setName] = useState(defaultName ?? `Broadcast ${new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
  const [when, setWhen] = useState("");
  const [attest, setAttest] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(audience);

  useEffect(() => {
    getBroadcastRefs().then((r) => {
      if (r.error) { setRefErr(r.error); return; }
      setRefs(r); setNum(r.numbers[0]?.id ?? "");
    });
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      previewBroadcast(JSON.parse(key) as Audience, attest).then((r) => {
        if (!live) return;
        setLoading(false);
        if (r.error) setErr(r.error); else { setErr(null); setPreview(r.preview ?? null); }
      });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [key, attest]);

  const waba = refs?.numbers.find((n) => n.id === num)?.waba_id;
  const options = (refs?.templates ?? []).filter((t) => t.waba_id === waba);
  const t = options.find((x) => `${x.name}|${x.language}` === tpl);
  const vars = t ? new Set(t.body.match(/\{\{\d+\}\}/g) ?? []).size : 0;
  const sampleName = preview?.sample[0]?.name || "Customer";
  const rendered = t ? t.body.replace(/\{\{(\d+)\}\}/g, (_, k) => {
    const v = params[Number(k) - 1];
    return v ? v.replace(/\{\{name\}\}/g, sampleName).replace(/\{\{first_name\}\}/g, sampleName.split(" ")[0]) : `{{${k}}}`;
  }) : "";

  const send = async () => {
    if (!t) { setErr("Choose an approved template."); return; }
    if (params.slice(0, vars).some((p) => !p?.trim()) || params.length < vars) { setErr("Fill every template value."); return; }
    if (attest && !note.trim()) { setErr("Describe how these contacts gave WhatsApp opt-in."); return; }
    if (!window.confirm(`Send “${t.name}” to ${preview?.eligible ?? 0} contact(s)?`)) return;
    setBusy(true); setErr(null);
    const r = await sendBroadcast({ audience, name, number_id: num, template: tpl, params: params.slice(0, vars), scheduled_at: when || undefined, opt_in_note: attest ? note : undefined });
    setBusy(false);
    if (r.error || !r.id) { setErr(r.error ?? "Could not create the broadcast"); return; }
    onDone?.();
    router.push(`/whatsapp/campaigns/${r.id}?new=${r.status}`);
  };

  if (refErr) return <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{refErr}</p>;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="mb-1 flex items-center gap-2 font-semibold text-navy-900"><Icon name="contacts" className="h-4 w-4" />Audience {loading && <span className="text-xs font-normal text-slate-400">checking…</span>}</div>
        {preview ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="badge bg-brand-100 text-brand-700">{preview.eligible} will get the message</span>
            <span className="badge bg-slate-200">{preview.total} contact{preview.total === 1 ? "" : "s"} matched</span>
            {preview.no_consent > 0 && <span className="badge bg-amber-50 text-amber-800">{preview.no_consent} {attest ? "opt-in recorded on send" : `excluded: ${REASON.no_consent}`}</span>}
            {preview.opted_out > 0 && <span className="badge bg-red-50 text-red-700">{preview.opted_out} excluded: {REASON.opted_out}</span>}
            {preview.suppressed > 0 && <span className="badge bg-slate-200">{preview.suppressed} excluded: {REASON.suppressed}</span>}
          </div>
        ) : !err && <div className="text-xs text-slate-500">Counting…</div>}
        <p className="mt-1 text-[11px] text-slate-500">One message per customer (latest lead). Opted-out, suppressed and no-opt-in numbers are skipped; quiet hours and the weekly cap are respected.</p>
      </div>

      {refs && refs.numbers.length === 0 ? (
        <p className="text-sm text-amber-700">No active WhatsApp number. Connect one in WhatsApp → Connections.</p>
      ) : refs && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Broadcast name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
            <Field label="Send from number"><select className="input" value={num} onChange={(e) => { setNum(e.target.value); setTpl(""); }}>
              {refs.numbers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
            <Field label="Approved template"><select className="input" value={tpl} onChange={(e) => { setTpl(e.target.value); setParams([]); }}>
              <option value="">Choose…</option>
              {options.map((x) => <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>{x.name} ({x.language}) · {x.category}</option>)}</select></Field>
            <Field label="Send at (IST)" hint="Blank = now. Quiet hours still apply."><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          </div>
          {options.length === 0 && <p className="text-sm text-amber-700">No approved templates for this number. Sync or create one in WhatsApp → Templates.</p>}
          {Array.from({ length: vars }).map((_, i) => (
            <Field key={i} label={`Value for {{${i + 1}}}`} hint={i === 0 ? "Use {{name}} or {{first_name}} for each customer's name." : undefined}>
              <input className="input" value={params[i] ?? ""} onChange={(e) => setParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })} />
            </Field>
          ))}
          {t && (
            <div className="rounded-lg bg-[#eef2f5] p-3">
              <div className="max-w-sm whitespace-pre-wrap rounded-lg bg-white p-3 text-sm shadow-sm">{rendered || "Template body not available."}</div>
              <div className="mt-1 text-[11px] text-slate-500">Preview for {sampleName}</div>
            </div>
          )}
          {refs.canConsent && (preview?.no_consent ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
                <span>These {preview?.no_consent} contacts agreed to get WhatsApp messages from us. Record their opt-in.</span></label>
              {attest && <input className="input mt-2" placeholder="How did they opt in? e.g. ticked WhatsApp box on our website form" value={note} onChange={(e) => setNote(e.target.value)} />}
              <p className="mt-1 text-[11px] text-amber-800">Only tick this if it is true. Messaging people without consent can get the number blocked by Meta.</p>
            </div>
          )}
          {!refs.canApprove && <p className="text-xs text-slate-500">You can create broadcasts but not approve them: it goes to a manager for approval first.</p>}
        </>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex justify-end gap-2">
        {onDone && <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>}
        <button type="button" className="btn-primary" disabled={busy || !refs || !t || !preview || preview.eligible === 0} onClick={send}>
          <Icon name="send" className="h-4 w-4" />{busy ? "Creating…" : refs?.canApprove ? (when ? "Schedule broadcast" : "Send broadcast") : "Submit for approval"}
        </button>
      </div>
    </div>
  );
}
