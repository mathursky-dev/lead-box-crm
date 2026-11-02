"use client";
import { useEffect, useState } from "react";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { Icon } from "@/components/kit";
import { saveForm, deleteForm, toggleForm, generateFormCode } from "@/lib/actions/settings";
import { FORM_FONTS, STD_FORM_FIELDS, SWATCHES, viewFields, type CustomField, type FormFieldDef } from "@/lib/settings-shared";
import { LeadFormView } from "@/components/lead-form-view";
import { fmtDateTime } from "@/lib/dates";
import { ListCard, RefreshButton, IconAction, useAct, match } from "../ui";

export type FormRow = {
  id: string; name: string; form_type: string; code: string; description: string; redirect_url: string | null; thank_you: string;
  bg_color: string; font: string; title_size: number; label_size: number; fields: FormFieldDef[];
  source_id: string | null; product_id: string | null; department_id: string | null; tag_id: string | null;
  is_active: boolean; submissions: number; last_submit_at: string | null; created_at: string;
};
type Opt = { id: string; name: string };
type Refs = { sources: Opt[]; products: Opt[]; departments: Opt[]; tags: Opt[] };

function useOrigin() {
  const [o, setO] = useState("");
  useEffect(() => setO(window.location.origin), []);
  return o;
}

export function FormList({ rows, customFields, refs }: { rows: FormRow[]; customFields: CustomField[]; refs: Refs }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<FormRow | "new" | null>(null);
  const [copied, setCopied] = useState("");
  const act = useAct();
  const origin = useOrigin();
  const list = rows.filter((f) => match(q, f.name, f.code));
  const copy = (code: string) => { navigator.clipboard?.writeText(`${origin}/f/${code}`).then(() => { setCopied(code); setTimeout(() => setCopied(""), 1500); }); };
  return (
    <>
      <ListCard title="List of Forms" q={q} setQ={setQ} footer={`Total ${rows.length} Records`}
        actions={<><button type="button" className="btn-primary" onClick={() => setEdit("new")}>+ Add Form</button><RefreshButton /></>}>
        {act.banner}
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-slate-200">
            <tr><th className="th">Code</th><th className="th">Form Name</th><th className="th">Form link</th><th className="th">Leads received</th><th className="th">Status</th><th className="th text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {list.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={6}>{rows.length ? "No forms match." : "No forms yet. Make a form, share its link (website, Instagram bio, WhatsApp, QR) and every submission becomes a lead here."}</td></tr>}
            {list.map((f) => (
              <tr key={f.id} className={f.is_active ? "" : "text-slate-400"}>
                <td className="td font-mono text-xs">{f.code}</td>
                <td className="td"><div className="font-medium text-navy-900">{f.name}</div><div className="text-xs text-slate-500">{f.fields.length} fields · created {fmtDateTime(f.created_at)}</div></td>
                <td className="td text-sm">
                  <span className="flex items-center gap-2">
                    <a href={`/f/${f.code}`} target="_blank" rel="noreferrer" className="max-w-56 truncate text-brand-700 hover:underline">{origin.replace(/^https?:\/\//, "")}/f/{f.code}</a>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => copy(f.code)}>{copied === f.code ? "Copied" : "Copy"}</button>
                  </span>
                </td>
                <td className="td text-sm">{f.submissions}{f.last_submit_at && <div className="text-xs text-slate-500">last {fmtDateTime(f.last_submit_at)}</div>}</td>
                <td className="td text-sm"><span className={`badge ${f.is_active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{f.is_active ? "Live" : "Paused"}</span></td>
                <td className="td"><span className="flex justify-end gap-1.5">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => act.run(() => toggleForm(f.id, !f.is_active))}>{f.is_active ? "Pause" : "Go live"}</button>
                  <IconAction icon="pencil" label={`Edit ${f.name}`} onClick={() => setEdit(f)} />
                  <IconAction icon="trash" tone="red" label={`Delete ${f.name}`} onClick={() => act.run(() => deleteForm(f.id), `Delete form "${f.name}"? Its link stops working. Leads already received stay.`)} />
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" ? `Edit ${edit.name}` : "Add Form"} wide>
        {edit !== null && <FormEditor f={edit === "new" ? undefined : edit} customFields={customFields} refs={refs} onDone={() => setEdit(null)} />}
      </Modal>
    </>
  );
}

const Row = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="grid gap-1 sm:grid-cols-[150px_1fr] sm:items-start sm:gap-4">
    <span className="pt-2 text-sm font-semibold text-navy-900">{label}</span>
    <div>{children}{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>
  </div>
);

function FormEditor({ f, customFields, refs, onDone }: { f?: FormRow; customFields: CustomField[]; refs: Refs; onDone: () => void }) {
  const [name, setName] = useState(f?.name ?? "");
  const [code, setCode] = useState(f?.code ?? "");
  const [description, setDescription] = useState(f?.description ?? "");
  const [bg, setBg] = useState(f?.bg_color ?? "#3949AB");
  const [font, setFont] = useState(f?.font ?? "Nunito");
  const [titleSize, setTitleSize] = useState(f?.title_size ?? 38);
  const [labelSize, setLabelSize] = useState(f?.label_size ?? 12);
  const [fields, setFields] = useState<FormFieldDef[]>(f?.fields ?? [
    { key: "name", label: "Full name", required: true }, { key: "phone", label: "Mobile number", required: true },
  ]);
  useEffect(() => { if (!f) generateFormCode().then(setCode); }, [f]);

  const available = [
    ...STD_FORM_FIELDS.map((s) => ({ key: s.key, label: s.label })),
    ...customFields.map((c) => ({ key: `cf:${c.key}`, label: c.label })),
  ].filter((a) => !fields.some((x) => x.key === a.key));
  const set = (i: number, patch: Partial<FormFieldDef>) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => setFields((fs) => { const n = [...fs]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const cfLabel = new Map(customFields.map((c) => [`cf:${c.key}`, c.label]));

  return (
    <ActionForm action={saveForm} onOk={onDone} className="space-y-4">
      {f && <input type="hidden" name="id" value={f.id} />}
      <input type="hidden" name="fields" value={JSON.stringify(fields)} />
      <Row label="Form Name"><input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Row>
      <Row label="Form Type"><select className="input" name="form_type" defaultValue="lead"><option value="lead">Lead</option></select></Row>
      <Row label="Code" hint="The form link is /f/CODE.">
        <span className="flex items-center gap-2">
          <input className="input max-w-48 font-mono uppercase" name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} required maxLength={12} minLength={4} />
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700" title="New code" aria-label="Generate a new code" onClick={() => generateFormCode().then(setCode)}><Icon name="refresh" className="h-3.5 w-3.5" /></button>
        </span>
      </Row>
      <Row label="Description"><textarea className="input" name="description" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></Row>
      <Row label="Redirect URL" hint="Optional. After submitting, the visitor is sent here. Must start with https:// or http://">
        <input className="input" name="redirect_url" type="url" placeholder="Enter Link" defaultValue={f?.redirect_url ?? ""} />
      </Row>
      <Row label="Thank-you message"><input className="input" name="thank_you" maxLength={300} defaultValue={f?.thank_you ?? "Thank you! We will contact you shortly."} /></Row>

      <div className="border-t border-slate-200 pt-4 text-sm font-semibold text-navy-900">Fields</div>
      <div className="space-y-2">
        {fields.map((x, i) => (
          <div key={x.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
            <span className="flex flex-col text-xs text-slate-400">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30" aria-label="Move up">▲</button>
              <button type="button" disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30" aria-label="Move down">▼</button>
            </span>
            <input className="input h-8 min-w-40 flex-1" value={x.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Field label" maxLength={80} />
            <span className="text-xs text-slate-500">{x.key.startsWith("cf:") ? `Custom · ${cfLabel.get(x.key) ?? x.key.slice(3)}` : STD_FORM_FIELDS.find((s) => s.key === x.key)?.label}</span>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={x.required || x.key === "phone"} disabled={x.key === "phone"} onChange={(e) => set(i, { required: e.target.checked })} /> Required</label>
            {x.key !== "phone" && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        {available.length > 0 && (
          <select className="input max-w-xs" value="" aria-label="Add a field"
            onChange={(e) => { const a = available.find((v) => v.key === e.target.value); if (a) setFields((fs) => [...fs, { key: a.key, label: a.label, required: false }]); }}>
            <option value="">+ Add field…</option>
            {available.map((a) => <option key={a.key} value={a.key}>{a.key.startsWith("cf:") ? `Custom: ${a.label}` : a.label}</option>)}
          </select>
        )}
        <p className="text-xs text-slate-500">Mobile number is always required (leads are matched by phone). Make more fields in Custom Fields.</p>
      </div>

      <div className="border-t border-slate-200 pt-4 text-sm font-semibold text-navy-900">New leads from this form</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source"><select className="input" name="source_id" defaultValue={f?.source_id ?? ""}><option value="">Website Form (auto)</option>{refs.sources.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Product / Service"><select className="input" name="product_id" defaultValue={f?.product_id ?? ""}><option value="">—</option>{refs.products.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Department"><select className="input" name="department_id" defaultValue={f?.department_id ?? ""}><option value="">—</option>{refs.departments.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Tag"><select className="input" name="tag_id" defaultValue={f?.tag_id ?? ""}><option value="">—</option>{refs.tags.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      </div>

      <div className="border-t border-slate-200 pt-4 text-sm font-semibold text-navy-900">Appearance</div>
      <Row label="Background Color">
        <input type="hidden" name="bg_color" value={bg} />
        <span className="flex flex-wrap items-center gap-2">
          {SWATCHES.slice(0, 10).map((s) => (
            <button key={s} type="button" aria-label={`Colour ${s}`} onClick={() => setBg(s)} className={`h-8 w-8 rounded-full ${bg === s ? "ring-2 ring-navy-900 ring-offset-2" : ""}`} style={{ background: s }} />
          ))}
          <label className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-dashed border-slate-300 text-slate-500" title="Custom colour">
            +<input type="color" value={bg} onChange={(e) => setBg(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom colour" />
          </label>
        </span>
      </Row>
      <Row label="Font"><select className="input max-w-56" name="font" value={font} onChange={(e) => setFont(e.target.value)}>{FORM_FONTS.map((x) => <option key={x} value={x}>{x === "Nunito" ? "Default (Nunito)" : x}</option>)}</select></Row>
      <Row label="Form Name Size"><select className="input max-w-40" name="title_size" value={titleSize} onChange={(e) => setTitleSize(Number(e.target.value))}>{[24, 28, 32, 38, 44, 52].map((n) => <option key={n} value={n}>{n === 38 ? "Default (38px)" : `${n}px`}</option>)}</select></Row>
      <Row label="Field Names Size"><select className="input max-w-40" name="label_size" value={labelSize} onChange={(e) => setLabelSize(Number(e.target.value))}>{[11, 12, 13, 14, 16, 18].map((n) => <option key={n} value={n}>{n === 12 ? "Default (12px)" : `${n}px`}</option>)}</select></Row>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={f?.is_active ?? true} /> Live (link accepts submissions)</label>

      <div className="border-t border-slate-200 pt-4 text-sm font-semibold text-navy-900">Preview</div>
      <div className="rounded-xl bg-slate-100 p-4">
        <div className="mx-auto max-w-md">
          <LeadFormView preview look={{ name, description, bg_color: bg, font, title_size: titleSize, label_size: labelSize }} fields={viewFields(fields, customFields)} />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        <Submit>{f ? "Save" : "Add"}</Submit>
      </div>
    </ActionForm>
  );
}
