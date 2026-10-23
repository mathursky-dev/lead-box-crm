"use client";
import { useMemo, useState } from "react";
import { ActionForm, Field, Submit } from "@/components/ui";
import { quickSend } from "@/lib/actions/wa";

type N = { id: string; label: string; display_phone: string | null; waba_id: string; status: string };
type T = { name: string; language: string; category: string | null; waba_id: string; body: string };

export function SendForm({ numbers, templates, defaultPhone, defaultTemplate }: { numbers: N[]; templates: T[]; defaultPhone?: string; defaultTemplate?: string }) {
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? "");
  const [mode, setMode] = useState<"template" | "text">("template");
  const waba = numbers.find((n) => n.id === numberId)?.waba_id;
  const options = useMemo(() => templates.filter((t) => t.waba_id === waba), [templates, waba]);
  const [tpl, setTpl] = useState(defaultTemplate && options.some((t) => `${t.name}|${t.language}` === defaultTemplate) ? defaultTemplate : "");
  const chosen = options.find((t) => `${t.name}|${t.language}` === tpl);
  const vars = chosen ? [...new Set(chosen.body.match(/\{\{\s*\d+\s*\}\}/g) ?? [])] : [];
  const [params, setParams] = useState<string[]>([]);
  const preview = chosen ? vars.reduce((s, v, i) => s.split(v).join(params[i] || v), chosen.body) : "";
  return (
    <ActionForm action={quickSend} className="space-y-3">
      <input type="hidden" name="mode" value={mode} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From number">
          <select className="input" name="number_id" value={numberId} onChange={(e) => { setNumberId(e.target.value); setTpl(""); }}>
            {numbers.map((n) => <option key={n.id} value={n.id}>{n.label} {n.display_phone ? `· ${n.display_phone}` : ""}{n.status !== "connected" ? ` (${n.status})` : ""}</option>)}
          </select>
        </Field>
        <Field label="To (phone)" hint="With country code, or a local number for the default country.">
          <input className="input" name="phone" defaultValue={defaultPhone} required placeholder="+91 98xxxxxxx" inputMode="tel" />
        </Field>
        <Field label="Name (optional, for new contacts)"><input className="input" name="name" maxLength={100} /></Field>
        <div>
          <span className="label">Message type</span>
          <div className="flex rounded-md border border-slate-300 p-0.5 text-sm">
            {(["template", "text"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded px-3 py-1.5 ${mode === m ? "bg-navy-900 text-white" : "text-slate-600"}`}>{m === "template" ? "Template" : "Free text (24h)"}</button>
            ))}
          </div>
        </div>
      </div>
      {mode === "template" ? (
        <>
          <Field label="Approved template">
            <select className="input" name="template" value={tpl} onChange={(e) => { setTpl(e.target.value); setParams([]); }} required>
              <option value="">{options.length ? "Choose…" : "No approved templates for this number — sync in Templates"}</option>
              {options.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) · {t.category}</option>)}
            </select>
          </Field>
          {vars.map((v, i) => (
            <Field key={v} label={`Variable ${v}`}>
              <input className="input" name="param" required value={params[i] ?? ""} onChange={(e) => { const p = [...params]; p[i] = e.target.value; setParams(p); }} />
            </Field>
          ))}
          {chosen && <div className="rounded-lg bg-[#e7f8ee] p-3 text-sm whitespace-pre-wrap text-slate-800">{preview}</div>}
        </>
      ) : (
        <Field label="Message" hint="Only delivered if the customer wrote to you in the last 24 hours."><textarea className="input" name="body" rows={4} maxLength={4096} required /></Field>
      )}
      <Submit pendingText="Sending…">Send message</Submit>
    </ActionForm>
  );
}
