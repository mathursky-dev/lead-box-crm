"use client";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { saveBranch } from "@/lib/actions/admin";

type B = { id: string; name: string; code: string | null; city: string | null; address: string | null; phone: string | null; manager_id: string | null };

export function BranchEditButton({ branch, users }: { branch: B; users: { id: string; full_name: string }[] }) {
  return (
    <ModalButton label="Edit details" title={`Branch: ${branch.name}`} className="btn-ghost btn-sm">
      {(close) => (
        <ActionForm action={saveBranch} onOk={close}>
          <input type="hidden" name="id" value={branch.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Branch code"><input className="input" name="code" maxLength={20} placeholder="JPR" defaultValue={branch.code ?? ""} /></Field>
            <Field label="City"><input className="input" name="city" maxLength={80} defaultValue={branch.city ?? ""} /></Field>
          </div>
          <Field label="Address"><textarea className="input" name="address" rows={2} maxLength={300} defaultValue={branch.address ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone"><input className="input" name="phone" maxLength={30} defaultValue={branch.phone ?? ""} /></Field>
            <Field label="Branch manager">
              <select className="input" name="manager_id" defaultValue={branch.manager_id ?? ""}>
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </Field>
          </div>
          <p className="text-xs text-slate-500">To let someone see the whole branch (and only it), open Users, set their branch and tick <b>Branch access</b>.</p>
          <Submit>Save</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}
