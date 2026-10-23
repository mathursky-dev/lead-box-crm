"use client";
import { ActionForm, ActionButton, Submit, ModalButton, Field } from "@/components/ui";
import { createOrgItem, toggleOrgItem, renameOrgItem } from "@/lib/actions/admin";

type Item = { id: string; name: string; is_active?: boolean; color?: string; sub?: string; is_system?: boolean };
type Parent = { name: string; label: string; options: { id: string; name: string }[] };

export function OrgList({ table, title, items, parents = [], color }: { table: string; title: string; items: Item[]; parents?: Parent[]; color?: boolean }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">{title}</h2>
      <ActionForm action={createOrgItem} resetOnOk className="mb-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="table" value={table} />
        <input className="input max-w-56 flex-1" name="name" placeholder={`New ${title.toLowerCase().replace(/s$/, "")}`} required maxLength={100} />
        {parents.map((p) => (
          <select key={p.name} name={p.name} className="input max-w-44" aria-label={p.label}>
            <option value="">{p.label}: none</option>
            {p.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ))}
        {color && <input type="color" name="color" defaultValue="#0f766e" className="h-9 w-12 rounded border" aria-label="Colour" />}
        <Submit>Add</Submit>
      </ActionForm>
      {items.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
        <ul className="divide-y text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 py-2">
              <span className={i.is_active === false ? "text-slate-400 line-through" : ""}>
                {i.color && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: i.color }} />}
                {i.name}{i.sub && <span className="ml-2 text-xs text-slate-500">{i.sub}</span>}
              </span>
              <span className="flex gap-1">
                {!i.is_system && (
                  <ModalButton label="Rename" title={`Rename ${i.name}`} className="btn-ghost btn-sm">
                    {(close) => (
                      <ActionForm action={renameOrgItem} onOk={close}>
                        <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={i.id} />
                        <Field label="Name"><input className="input" name="name" defaultValue={i.name} required /></Field>
                        <Submit>Save</Submit>
                      </ActionForm>
                    )}
                  </ModalButton>
                )}
                {i.is_active !== undefined && !i.is_system && (
                  <ActionButton action={() => toggleOrgItem(table as never, i.id, !i.is_active)}
                    confirm={i.is_active ? `Deactivate "${i.name}"? Existing records keep it; it won't be offered for new ones.` : undefined}>
                    {i.is_active ? "Deactivate" : "Activate"}
                  </ActionButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
