"use client";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { saveSegment } from "@/lib/actions/nurture";
import type { Refs } from "@/lib/data";

type Seg = { id: string; name: string; rules: Record<string, unknown> };
const CATS = ["new", "assigned", "contacted", "interested", "follow_up", "scheduled", "won", "lost", "invalid"];

export function SegmentForm({ refs, segment }: { refs: Refs; segment?: Seg }) {
  const r = (segment?.rules ?? {}) as Record<string, string | string[] | boolean>;
  const has = (k: string, v: string) => Array.isArray(r[k]) && (r[k] as string[]).includes(v);
  const multi = (name: string, label: string, opts: { id: string; name: string }[]) => (
    <fieldset><legend className="label">{label}</legend>
      <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-auto">{opts.map((o) => <label key={o.id} className="flex items-center gap-1 text-sm"><input type="checkbox" name={name} value={o.id} defaultChecked={has(name, o.id)} /> {o.name}</label>)}</div>
    </fieldset>
  );
  return (
    <ModalButton label={segment ? "Edit" : "+ New segment"} title={segment ? `Edit ${segment.name}` : "New segment"} className={segment ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {(close) => (
        <ActionForm action={saveSegment} onOk={close}>
          {segment && <input type="hidden" name="id" value={segment.id} />}
          <Field label="Name"><input className="input" name="name" defaultValue={segment?.name} required /></Field>
          {multi("categories", "Lead status category (any of)", CATS.map((c) => ({ id: c, name: c.replace("_", " ") })))}
          {multi("product_ids", "Product interest (any of)", refs.products)}
          {multi("source_ids", "Source (any of)", refs.sources)}
          {refs.tags.length > 0 && multi("tag_ids", "Tag (any of)", refs.tags)}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="WhatsApp number"><select className="input" name="number_id" defaultValue={(r.number_id as string) ?? ""}><option value="">Any</option>{refs.numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
            <Field label="Purchase activity"><select className="input" name="purchased" defaultValue={(r.purchased as string) ?? "any"}><option value="any">Any</option><option value="yes">Has purchased</option><option value="no">Never purchased</option></select></Field>
            <Field label="Customer replied within (days)"><input className="input" type="number" min={1} name="replied_days" defaultValue={(r.replied_days as string) ?? ""} /></Field>
            <Field label="Inactive for at least (days)"><input className="input" type="number" min={1} name="inactive_days" defaultValue={(r.inactive_days as string) ?? ""} /></Field>
            <Field label="Created within (days)"><input className="input" type="number" min={1} name="created_within_days" defaultValue={(r.created_within_days as string) ?? ""} /></Field>
            <fieldset><legend className="label">Priority</legend><div className="flex flex-wrap gap-2">{["low", "normal", "high", "urgent"].map((p) => (
              <label key={p} className="flex items-center gap-1 text-sm"><input type="checkbox" name="priority" value={p} defaultChecked={String(r.priority ?? "").split(",").includes(p)} /> {p}</label>))}</div></fieldset>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="include_closed" defaultChecked={r.include_closed === true} /> Include closed leads (won/lost/invalid) — e.g. for repeat-purchase offers</label>
          <p className="text-xs text-slate-500">Each customer is counted once (their latest matching lead). Only customers with recorded WhatsApp opt-in can be messaged.</p>
          <Submit>Save segment</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}
