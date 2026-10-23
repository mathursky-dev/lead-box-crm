"use client";
import { useMemo, useState } from "react";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { saveCampaign } from "@/lib/actions/nurture";

type Tpl = { name: string; language: string; category: string | null; waba_id: string; body: string };
type C = { id: string; name: string; segment_id: string; number_id: string; template_name: string; template_language: string; template_params: string[]; offer_id: string | null; scheduled_at: string | null };

export function CampaignForm({ segments, offers, numbers, templates, campaign }: {
  segments: { id: string; name: string }[]; offers: { id: string; name: string; status: string }[];
  numbers: { id: string; label: string; waba_id: string }[]; templates: Tpl[]; campaign?: C;
}) {
  const [num, setNum] = useState(campaign?.number_id ?? numbers[0]?.id ?? "");
  const [tpl, setTpl] = useState(campaign ? `${campaign.template_name}|${campaign.template_language}` : "");
  const waba = numbers.find((n) => n.id === num)?.waba_id;
  const options = templates.filter((t) => t.waba_id === waba);
  const t = options.find((x) => `${x.name}|${x.language}` === tpl);
  const n = useMemo(() => (t ? new Set(t.body.match(/\{\{\d+\}\}/g) ?? []).size : 0), [t]);
  return (
    <ModalButton label={campaign ? "Edit" : "+ New campaign"} title={campaign ? `Edit ${campaign.name}` : "New campaign"} className={campaign ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {() => (
        <ActionForm action={saveCampaign}>
          {campaign && <input type="hidden" name="id" value={campaign.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" name="name" defaultValue={campaign?.name} required /></Field>
            <Field label="Segment"><select className="input" name="segment_id" defaultValue={campaign?.segment_id ?? ""} required><option value="" disabled>Choose…</option>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Send from number"><select className="input" name="number_id" value={num} onChange={(e) => { setNum(e.target.value); setTpl(""); }} required>{numbers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
            <Field label="Approved template"><select className="input" name="template" value={tpl} onChange={(e) => setTpl(e.target.value)} required>
              <option value="" disabled>Choose…</option>{options.map((x) => <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>{x.name} ({x.language}) · {x.category}</option>)}</select></Field>
            <Field label="Offer (optional)"><select className="input" name="offer_id" defaultValue={campaign?.offer_id ?? ""}><option value="">None</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.status.replace("_", " ")})</option>)}</select></Field>
            <Field label="Send at (IST)" hint="Blank = as soon as approved. Quiet hours still apply."><input className="input" type="datetime-local" name="scheduled_at" defaultValue={campaign?.scheduled_at?.slice(0, 16) ?? ""} /></Field>
          </div>
          {t && <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm text-slate-700">{t.body}</p>}
          {Array.from({ length: n }).map((_, i) => (
            <Field key={i} label={`Value for {{${i + 1}}}`} hint={i === 0 ? "Tokens: {{name}} {{first_name}} {{offer_name}} {{offer_code}} {{offer_valid_to}}" : undefined}>
              <input className="input" name="params" defaultValue={campaign?.template_params?.[i] ?? ""} required />
            </Field>
          ))}
          {options.length === 0 && <p className="text-sm text-amber-700">No approved templates for this number. Sync templates in Admin → WhatsApp numbers.</p>}
          <Submit>Save draft</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}
