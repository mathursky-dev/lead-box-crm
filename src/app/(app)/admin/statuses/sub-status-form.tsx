"use client";
import { ActionButton, ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { saveSubStatus, deleteSubStatus } from "@/lib/actions/admin";
import type { StatusOpt, SubStatusOpt } from "@/lib/data";

export function SubStatusForm({ sub, statuses }: { sub?: SubStatusOpt; statuses: StatusOpt[] }) {
  return (
    <ModalButton label={sub ? "Edit" : "+ Add sub-status"} title={sub ? `Edit ${sub.name}` : "Add sub-status"} className={sub ? "btn-ghost btn-sm" : "btn-primary"}>
      {(close) => (
        <ActionForm action={saveSubStatus} onOk={close}>
          {sub && <input type="hidden" name="id" value={sub.id} />}
          <Field label="Name"><input className="input" name="name" defaultValue={sub?.name} placeholder="e.g. Not picked" required /></Field>
          <Field label="Under status" hint="Pick a status to show it only there, or leave it on Any status.">
            <select className="input" name="status_id" defaultValue={sub?.status_id ?? ""}>
              <option value="">Any status</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Sort order"><input className="input" type="number" name="sort_order" defaultValue={sub?.sort_order ?? 100} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={sub?.is_active ?? true} /> Active</label>
          <Submit>Save</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function DeleteSubStatus({ id, name }: { id: string; name: string }) {
  return <ActionButton action={() => deleteSubStatus(id)} confirm={`Delete "${name}"? Leads that have it will just lose the sub-status.`}>Delete</ActionButton>;
}
