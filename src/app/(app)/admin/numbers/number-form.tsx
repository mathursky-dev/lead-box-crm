"use client";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { saveNumber, testNumber, subscribeWebhook, syncTemplates } from "@/lib/actions/whatsapp";
import type { Refs } from "@/lib/data";

type N = { id: string; label: string; phone_number_id: string; waba_id: string; branch_id: string | null; department_id: string | null; team_id: string | null; product_id: string | null; is_active: boolean; teams: string[]; users: string[] };

export function NumberForm({ refs, number }: { refs: Refs; number?: N }) {
  const sel = (name: string, label: string, opts: { id: string; name: string }[], v: string | null | undefined, hint?: string) => (
    <Field label={label} hint={hint}><select className="input" name={name} defaultValue={v ?? ""}><option value="">—</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
  );
  return (
    <ModalButton label={number ? "Edit" : "+ Connect number"} title={number ? `Edit ${number.label}` : "Connect WhatsApp number"} className={number ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {(close) => (
        <ActionForm action={saveNumber} onOk={close}>
          {number && <input type="hidden" name="id" value={number.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Label"><input className="input" name="label" defaultValue={number?.label} required placeholder="Sales – Mumbai" /></Field>
            <Field label="Phone number ID"><input className="input" name="phone_number_id" defaultValue={number?.phone_number_id} required inputMode="numeric" /></Field>
            <Field label="WhatsApp Business Account ID"><input className="input" name="waba_id" defaultValue={number?.waba_id} required inputMode="numeric" /></Field>
            <Field label={number ? "New access token (leave blank to keep)" : "Access token (System User, permanent)"}>
              <input className="input" name="access_token" type="password" autoComplete="off" required={!number} />
            </Field>
            {sel("team_id", "Default team for new chats", refs.teams, number?.team_id, "New leads from this number get this team.")}
            {sel("branch_id", "Branch for new leads", refs.branches, number?.branch_id)}
            {sel("department_id", "Department for new leads", refs.departments, number?.department_id)}
            {sel("product_id", "Product for new leads", refs.products, number?.product_id)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={number?.is_active ?? true} /> Active (allow sending)</label>
          </div>
          <fieldset><legend className="label">Teams that may use this number (admins always can)</legend>
            <div className="grid gap-1 sm:grid-cols-3">{refs.teams.map((t) => <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="teams" value={t.id} defaultChecked={number?.teams.includes(t.id)} /> {t.name}</label>)}</div>
          </fieldset>
          <fieldset><legend className="label">Individual users who may use this number</legend>
            <div className="grid max-h-40 gap-1 overflow-auto sm:grid-cols-3">{refs.users.filter((u) => u.is_active).map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="users" value={u.id} defaultChecked={number?.users.includes(u.id)} /> {u.full_name}</label>)}</div>
          </fieldset>
          <Submit pendingText="Verifying with Meta…">{number ? "Save" : "Verify & connect"}</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function NumberActions({ id }: { id: string }) {
  return (
    <>
      <ActionButton action={() => testNumber(id)}>Test connection</ActionButton>
      <ActionButton action={() => subscribeWebhook(id)}>Subscribe webhook</ActionButton>
      <ActionButton action={() => syncTemplates(id)}>Sync templates</ActionButton>
    </>
  );
}
