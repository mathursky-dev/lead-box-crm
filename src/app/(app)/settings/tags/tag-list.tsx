"use client";
import { useState } from "react";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { saveTag, deleteTags } from "@/lib/actions/settings";
import { onColor } from "@/lib/settings-shared";
import { ListCard, ColorChip, ColorInput, IconAction, useAct, match } from "../ui";

export type TagRow = { id: string; name: string; color: string; description: string; leads?: number };
const SIZES = [20, 50, 100];

export function TagList({ rows }: { rows: TagRow[] }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<TagRow | "new" | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [per, setPer] = useState(20);
  const [page, setPage] = useState(0);
  const [bulk, setBulk] = useState(false);
  const act = useAct();
  const list = rows.filter((t) => match(q, t.name, t.description, t.color));
  const pages = Math.max(1, Math.ceil(list.length / per));
  const pg = Math.min(page, pages - 1);
  const shown = list.slice(pg * per, pg * per + per);
  const allOn = shown.length > 0 && shown.every((t) => sel.has(t.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const removeSel = () => act.run(async () => { const r = await deleteTags([...sel]); if (!r?.error) setSel(new Set()); return r; },
    `Delete ${sel.size} tag(s)? They will be removed from every lead and chat.`);

  return (
    <>
      <ListCard title="Tags" q={q} setQ={(v) => { setQ(v); setPage(0); }}
        actions={<>
          <div className="relative">
            <button type="button" className="btn-ghost" disabled={sel.size === 0} onClick={() => setBulk((b) => !b)} aria-expanded={bulk}>Bulk Actions{sel.size ? ` (${sel.size})` : ""} ▾</button>
            {bulk && sel.size > 0 && (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <button type="button" className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50" onClick={() => { setBulk(false); removeSel(); }}>Delete selected</button>
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setBulk(false); setSel(new Set()); }}>Clear selection</button>
              </div>
            )}
          </div>
          <button type="button" className="btn-primary" onClick={() => setEdit("new")}>Add Tag +</button>
        </>}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 font-normal">
            <span><b>{list.length} Tags</b> | Show{" "}
              <select className="input inline-block h-8 w-20 py-0" value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(0); }} aria-label="Rows per page">
                {SIZES.map((n) => <option key={n}>{n}</option>)}
              </select>{" "}rows per page</span>
            <span className="flex items-center gap-1">
              <button type="button" className="btn-ghost btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Prev</button>
              <span className="px-2 text-xs">{pg + 1} / {pages}</span>
              <button type="button" className="btn-ghost btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next ›</button>
            </span>
          </div>
        }>
        {act.banner}
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="th w-10"><input type="checkbox" checked={allOn} aria-label="Select all on this page"
                onChange={() => setSel((s) => { const n = new Set(s); shown.forEach((t) => (allOn ? n.delete(t.id) : n.add(t.id))); return n; })} /></th>
              <th className="th">Name</th><th className="th">Color</th><th className="th">Type</th><th className="th">Description</th><th className="th">Leads</th><th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={7}>{rows.length ? "No tags match." : "No tags yet. Add one to label leads (e.g. Hot buyer, Repeat lead, Ad campaign)."}</td></tr>}
            {shown.map((t) => (
              <tr key={t.id} className={sel.has(t.id) ? "bg-brand-50/40" : ""}>
                <td className="td"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.name}`} /></td>
                <td className="td"><span className="badge max-w-md truncate" style={{ background: t.color, color: onColor(t.color) }}>{t.name}</span></td>
                <td className="td"><ColorChip color={t.color} /></td>
                <td className="td text-sm">lead</td>
                <td className="td max-w-sm truncate text-sm text-slate-600" title={t.description}>{t.description || "—"}</td>
                <td className="td text-sm">{t.leads ?? 0}</td>
                <td className="td"><span className="flex justify-end gap-1.5">
                  <IconAction icon="pencil" label={`Edit ${t.name}`} onClick={() => setEdit(t)} />
                  <IconAction icon="trash" tone="red" label={`Delete ${t.name}`} onClick={() => act.run(() => deleteTags([t.id]), `Delete tag "${t.name}"? It is removed from every lead and chat.`)} />
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit && edit !== "new" ? `Edit ${edit.name}` : "Add tag"}>
        {edit !== null && (
          <ActionForm action={saveTag} onOk={() => setEdit(null)}>
            {edit !== "new" && <input type="hidden" name="id" value={edit.id} />}
            <Field label="Tag name"><input className="input" name="name" defaultValue={edit === "new" ? "" : edit.name} required maxLength={100} /></Field>
            <Field label="Color"><ColorInput defaultValue={edit === "new" ? null : edit.color} /></Field>
            <Field label="Description"><textarea className="input" name="description" rows={2} maxLength={300} defaultValue={edit === "new" ? "" : edit.description} /></Field>
            <Submit>Save</Submit>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
