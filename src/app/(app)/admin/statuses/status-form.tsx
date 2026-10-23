"use client";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { saveStatus } from "@/lib/actions/admin";
import type { StatusOpt } from "@/lib/data";

const CATS = [["new", "New"], ["assigned", "Assigned"], ["contacted", "Contacted"], ["interested", "Interested"], ["follow_up", "Follow-up"],
  ["scheduled", "Demo/Consultation Scheduled"], ["won", "Converted/Won"], ["lost", "Lost"], ["invalid", "Invalid"]];

export function StatusForm({ status }: { status?: StatusOpt }) {
  return (
    <ModalButton label={status ? "Edit" : "+ Add status"} title={status ? `Edit ${status.name}` : "Add status"} className={status ? "btn-ghost btn-sm" : "btn-primary"}>
      {(close) => (
        <ActionForm action={saveStatus} onOk={close}>
          {status && <input type="hidden" name="id" value={status.id} />}
          <Field label="Name"><input className="input" name="name" defaultValue={status?.name} required /></Field>
          <Field label="Reporting category" hint="Dashboards count by category, not by name.">
            <select className="input" name="category" defaultValue={status?.category ?? "contacted"}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <Field label="Sort order"><input className="input" type="number" name="sort_order" defaultValue={status?.sort_order ?? 100} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={status?.is_active ?? true} /> Active</label>
          <Submit>Save</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}
