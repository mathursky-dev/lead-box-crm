"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { BroadcastForm } from "@/components/broadcast-form";
import { assignLeads } from "@/lib/actions/leads";
import { bulkUpdateLeads, type BulkAction } from "@/lib/actions/broadcast";
import type { StatusOpt, SubStatusOpt } from "@/lib/data";

type Panel = null | "assign" | "status" | "sub_status" | "tags" | "priority";
const CLOSED = new Set(["won", "lost", "invalid"]);

export type BulkPerms = { assign: boolean; status: boolean; edit: boolean; del: boolean; broadcast: boolean; requireNext: boolean };

/** Action bar shown when leads are ticked: assign, status, sub-status, tags, priority, WhatsApp broadcast, delete. */
export function BulkBar({ ids, perms, users, statuses, subStatuses, tags, busy, onClear, onDelete, onNote }: {
  ids: string[]; perms: BulkPerms; users: { id: string; name: string }[]; statuses: StatusOpt[]; subStatuses: SubStatusOpt[];
  tags: { id: string; name: string }[]; busy: boolean; onClear: () => void; onDelete: () => void;
  /** Result message; shown by the table so it survives the bar closing when the selection clears. */
  onNote: (text: string, bad?: boolean) => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [wa, setWa] = useState(false);
  const [working, setWorking] = useState(false);
  const n = ids.length;
  const toggle = (p: Panel) => setPanel((x) => (x === p ? null : p));

  const run = async (a: BulkAction) => {
    setWorking(true);
    const r = await bulkUpdateLeads(ids, a);
    setWorking(false);
    if (r.error) { onNote(r.error, true); return; }
    const why = Object.entries(r.errors ?? {}).map(([k, v]) => `${k} (${v})`).join("; ");
    onNote(`${r.ok} lead${r.ok === 1 ? "" : "s"} updated${r.failed ? `, ${r.failed} not changed: ${why}` : ""}.`, !!r.failed);
    setPanel(null);
    if (!r.failed) onClear();
    router.refresh();
  };

  const btn = (p: Panel, icon: string, label: string) => (
    <button type="button" onClick={() => toggle(p)} aria-expanded={panel === p}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${panel === p ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-navy-900 hover:bg-slate-50"}`}>
      <Icon name={icon} className="h-3.5 w-3.5" />{label}
    </button>
  );

  return (
    <div className="card mb-3 border-brand-100 bg-brand-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold text-navy-900">{n} selected</span>
        {perms.assign && btn("assign", "user", "Assign")}
        {perms.status && btn("status", "target", "Status")}
        {perms.status && subStatuses.length > 0 && btn("sub_status", "layers", "Sub-status")}
        {perms.edit && tags.length > 0 && btn("tags", "tag", "Tags")}
        {perms.edit && btn("priority", "bolt", "Priority")}
        {perms.broadcast && (
          <button type="button" onClick={() => setWa(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            <Icon name="send" className="h-3.5 w-3.5" />WhatsApp
          </button>
        )}
        <button type="button" className="btn-ghost btn-sm" onClick={onClear}>Clear</button>
        {perms.del && (
          <button type="button" disabled={busy} onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
            <Icon name="trash" className="h-3.5 w-3.5" />{busy ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      {panel && (
        <div className="mt-3 border-t border-brand-100 pt-3">
          {panel === "assign" && (
            <ActionForm action={assignLeads} onOk={() => { setPanel(null); onClear(); onNote(`${n} lead${n === 1 ? "" : "s"} assigned.`); }} className="flex flex-wrap items-end gap-2">
              {ids.map((id) => <input key={id} type="hidden" name="lead_ids" value={id} />)}
              <Field label="Assign to">
                <select className="input min-w-48" name="owner_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  <option value="__auto__">Round-robin (allocation rules)</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Reason (required when reassigning)"><input className="input min-w-64" name="reason" /></Field>
              <Submit>Assign {n}</Submit>
            </ActionForm>
          )}
          {panel === "status" && <StatusPanel statuses={statuses} requireNext={perms.requireNext} n={n} working={working} onRun={run} />}
          {panel === "sub_status" && <SubStatusPanel subStatuses={subStatuses} statuses={statuses} n={n} working={working} onRun={run} />}
          {panel === "tags" && <TagsPanel tags={tags} n={n} working={working} onRun={run} />}
          {panel === "priority" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">Set priority of {n} lead{n === 1 ? "" : "s"} to</span>
              {(["low", "normal", "high", "urgent"] as const).map((p) => (
                <button key={p} type="button" disabled={working} className="btn-ghost btn-sm capitalize" onClick={() => run({ action: "priority", priority: p })}>{p}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={wa} onClose={() => setWa(false)} title={`WhatsApp broadcast to ${n} lead${n === 1 ? "" : "s"}`} wide>
        {wa && <BroadcastForm audience={{ lead_ids: ids }} onDone={() => setWa(false)} />}
      </Modal>
    </div>
  );
}

function StatusPanel({ statuses, requireNext, n, working, onRun }: { statuses: StatusOpt[]; requireNext: boolean; n: number; working: boolean; onRun: (a: BulkAction) => void }) {
  const [sid, setSid] = useState("");
  const [reason, setReason] = useState("");
  const [due, setDue] = useState("");
  const s = statuses.find((x) => x.id === sid);
  const lostLike = s && (s.category === "lost" || s.category === "invalid");
  const open = s && !CLOSED.has(s.category);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (sid) onRun({ action: "status", status_id: sid, reason: reason || undefined, due: due || undefined }); }}>
      <Field label="New status">
        <select className="input min-w-48" value={sid} onChange={(e) => setSid(e.target.value)} required>
          <option value="" disabled>Choose…</option>
          {statuses.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <Field label={lostLike ? "Reason (required)" : "Comment (optional)"}><input className="input min-w-56" value={reason} onChange={(e) => setReason(e.target.value)} required={!!lostLike} list={lostLike ? `lb-reasons-${s!.category}` : undefined} autoComplete="off" placeholder={lostLike ? "Pick or type a reason" : undefined} /></Field>
      {open && (
        <Field label={requireNext ? "Next follow-up (needed if lead has none)" : "Next follow-up (optional)"}>
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      )}
      <button type="submit" className="btn-primary" disabled={working || !sid}>{working ? "Updating…" : `Update ${n}`}</button>
    </form>
  );
}

function SubStatusPanel({ subStatuses, statuses, n, working, onRun }: { subStatuses: SubStatusOpt[]; statuses: StatusOpt[]; n: number; working: boolean; onRun: (a: BulkAction) => void }) {
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onRun({ action: "sub_status", sub_status_id: ref.current?.value || null }); }}>
      <Field label="Sub-status" hint="Leads whose status doesn't allow it are left unchanged.">
        <select ref={ref} className="input min-w-56" defaultValue="">
          <option value="">— Clear sub-status —</option>
          {subStatuses.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}{x.status_id ? ` (${statuses.find((s) => s.id === x.status_id)?.name ?? ""})` : ""}</option>)}
        </select>
      </Field>
      <button type="submit" className="btn-primary" disabled={working}>{working ? "Updating…" : `Update ${n}`}</button>
    </form>
  );
}

function TagsPanel({ tags, n, working, onRun }: { tags: { id: string; name: string }[]; n: number; working: boolean; onRun: (a: BulkAction) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <div className="space-y-2">
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
        {tags.map((t) => {
          const on = sel.includes(t.id);
          return <button key={t.id} type="button" aria-pressed={on} onClick={() => setSel((x) => (on ? x.filter((y) => y !== t.id) : [...x, t.id]))}
            className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white hover:bg-slate-50"}`}>{t.name}</button>;
        })}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-primary btn-sm" disabled={working || !sel.length} onClick={() => onRun({ action: "tags_add", tag_ids: sel })}>Add to {n}</button>
        <button type="button" className="btn-ghost btn-sm" disabled={working || !sel.length} onClick={() => onRun({ action: "tags_remove", tag_ids: sel })}>Remove from {n}</button>
      </div>
    </div>
  );
}
