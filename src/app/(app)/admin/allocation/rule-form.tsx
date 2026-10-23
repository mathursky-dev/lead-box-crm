"use client";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { saveRule, deleteRule } from "@/lib/actions/admin";
import type { Refs } from "@/lib/data";

type Rule = { id: string; name: string; priority: number; strategy?: string; fallback_to_backup?: boolean; is_active: boolean; match_number_id: string | null; match_branch_id: string | null; match_department_id: string | null; match_product_id: string | null; match_source_id: string | null; users: string[] };

export function RuleForm({ refs, users, rule }: { refs: Refs; users: { id: string; name: string; active: boolean }[]; rule?: Rule }) {
  const sel = (name: string, label: string, opts: { id: string; name?: string; label?: string }[], v: string | null) => (
    <Field label={label}><select className="input" name={name} defaultValue={v ?? ""}><option value="">Any</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name ?? o.label}</option>)}</select></Field>
  );
  return (
    <ModalButton label={rule ? "Edit" : "+ Add rule"} title={rule ? `Edit rule: ${rule.name}` : "New allocation rule"} className={rule ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {(close) => (
        <ActionForm action={saveRule} onOk={close}>
          {rule && <input type="hidden" name="id" value={rule.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" name="name" defaultValue={rule?.name} required /></Field>
            <Field label="Priority (lower runs first)"><input className="input" type="number" name="priority" defaultValue={rule?.priority ?? 100} min={0} /></Field>
            <Field label="Strategy"><select className="input" name="strategy" defaultValue={rule?.strategy ?? "round_robin"}><option value="round_robin">Round-robin</option><option value="least_loaded">Least loaded (fewest open leads)</option></select></Field>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="fallback_to_backup" defaultChecked={rule?.fallback_to_backup ?? true} /> Use members&apos; backups when all are away / off-hours</label>
            {sel("match_number_id", "Business number", refs.numbers, rule?.match_number_id ?? null)}
            {sel("match_branch_id", "Branch", refs.branches, rule?.match_branch_id ?? null)}
            {sel("match_department_id", "Department", refs.departments, rule?.match_department_id ?? null)}
            {sel("match_product_id", "Product", refs.products, rule?.match_product_id ?? null)}
            {sel("match_source_id", "Source", refs.sources, rule?.match_source_id ?? null)}
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="is_active" defaultChecked={rule?.is_active ?? true} /> Active</label>
          </div>
          <fieldset>
            <legend className="label">Eligible users (round-robin order follows user id)</legend>
            <div className="grid max-h-56 gap-1 overflow-auto sm:grid-cols-2">
              {users.filter((u) => u.active || rule?.users.includes(u.id)).map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="users" value={u.id} defaultChecked={rule?.users.includes(u.id)} /> {u.name}{!u.active && " (inactive)"}</label>
              ))}
            </div>
          </fieldset>
          <Submit>Save rule</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function DeleteRule({ id, name }: { id: string; name: string }) {
  return <ActionButton action={() => deleteRule(id)} confirm={`Delete rule "${name}"? Existing assignments are not changed.`}>Delete</ActionButton>;
}
