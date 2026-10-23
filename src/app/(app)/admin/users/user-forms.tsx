"use client";
import { useState } from "react";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { createUser, updateUser, setUserActive, sendPasswordReset, setUserPassword } from "@/lib/actions/admin";
import type { Refs } from "@/lib/data";

import { PERMISSIONS as PERMS } from "@/lib/permissions";
type U = { id: string; full_name: string; email: string; username?: string | null; backup_user_id?: string | null; working_hours?: Record<string, [string, string]> | null; phone: string | null; role: string; branch_id: string | null; department_id: string | null; team_id: string | null; permissions: string[]; is_active: boolean; accepts_auto_allocation: boolean; allocation_limit: number | null };

function Fields({ refs, u, meRole, teamAccess }: { refs: Refs; u?: U; meRole: string; teamAccess?: string[] }) {
  const [role, setRole] = useState(u?.role ?? "agent");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name"><input className="input" name="full_name" defaultValue={u?.full_name} required /></Field>
      {!u && <Field label="Email" hint="Optional if you set a User ID."><input className="input" type="email" name="email" autoComplete="off" /></Field>}
      {!u && <Field label="User ID (login name)" hint="Optional. 3–40 chars: a–z, 0–9, . _ -"><input className="input lowercase" name="username" autoComplete="off" pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,39}" /></Field>}
      <Field label="Phone"><input className="input" name="phone" defaultValue={u?.phone ?? ""} /></Field>
      <Field label="Role">
        <select className="input" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="agent">Agent</option><option value="team_leader">Team Leader</option><option value="company_admin">Company Admin</option>
          {meRole === "super_admin" && <option value="super_admin">Super Admin</option>}
        </select>
      </Field>
      <Field label="Branch"><select className="input" name="branch_id" defaultValue={u?.branch_id ?? ""}><option value="">—</option>{refs.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Department"><select className="input" name="department_id" defaultValue={u?.department_id ?? ""}><option value="">—</option>{refs.departments.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Team"><select className="input" name="team_id" defaultValue={u?.team_id ?? ""}><option value="">—</option>{refs.teams.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Allocation limit (open leads)" hint="Blank = no limit"><input className="input" type="number" min={0} name="allocation_limit" defaultValue={u?.allocation_limit ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="accepts_auto_allocation" defaultChecked={u?.accepts_auto_allocation ?? true} /> Eligible for automatic round-robin allocation</label>
      {u && <Field label="Backup assignee" hint="Gets leads and SLA alerts when this user is away or outside working hours.">
        <select className="input" name="backup_user_id" defaultValue={u.backup_user_id ?? ""}><option value="">None</option>{refs.users.filter((x) => x.is_active && x.id !== u.id).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select>
      </Field>}
      {u && <WorkingHours value={u.working_hours ?? null} />}
      <fieldset className="sm:col-span-2">
        <legend className="label">Extra permissions (on top of the role — see Roles & permissions)</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {Object.entries(PERMS).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`perm_${k}`} defaultChecked={u?.permissions.includes(k)} /> {l}</label>
          ))}
        </div>
      </fieldset>
      {u && role === "team_leader" && (
        <fieldset className="sm:col-span-2">
          <legend className="label">Additional teams this leader can see (own team is always included)</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {refs.teams.map((t) => <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="team_access" value={t.id} defaultChecked={teamAccess?.includes(t.id)} /> {t.name}</label>)}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function PasswordFields() {
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const gen = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#";
    const v = Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join("");
    setPw(v); setConfirm(v); setShow(true);
  };
  const type = show ? "text" : "password";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Password" hint="Min 8 characters.">
        <input className="input" name="password" type={type} minLength={8} autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
      <Field label="Confirm password">
        <input className="input" name="password_confirm" type={type} minLength={8} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {confirm && pw !== confirm && <p className="text-xs text-red-600 sm:col-span-2">Passwords do not match.</p>}
      <div className="flex flex-wrap gap-3 text-sm sm:col-span-2">
        <button type="button" className="btn-ghost btn-sm" onClick={gen}>Generate strong password</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password</label>
      </div>
    </div>
  );
}

export function UserForm({ refs, meRole }: { refs: Refs; meRole: string }) {
  const [mode, setMode] = useState("password");
  return (
    <ModalButton label="+ Add user" title="Add user" wide>
      {() => (
        <ActionForm action={createUser}>
          <Fields refs={refs} meRole={meRole} />
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="mode" value="password" checked={mode === "password"} onChange={() => setMode("password")} /> Set User ID / password manually</label>
            <label className="flex items-center gap-2"><input type="radio" name="mode" value="invite" checked={mode === "invite"} onChange={() => setMode("invite")} /> Email invitation (needs SMTP)</label>
          </div>
          {mode === "password" && <PasswordFields />}
          <Submit>Create user</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

function SetPassword({ user }: { user: U }) {
  return (
    <ModalButton label="Set password" title={`Set password for ${user.full_name}`} className="btn-ghost btn-sm">
      {(close) => (
        <ActionForm action={setUserPassword} onOk={close}>
          <input type="hidden" name="id" value={user.id} />
          <PasswordFields />
          <Submit>Save password</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function UserRowActions({ user, refs, meId, meRole, teamAccess, canManageAuth }: { user: U; refs: Refs; meId: string; meRole: string; teamAccess: string[]; canManageAuth: boolean }) {
  return (
    <div className="flex justify-end gap-1">
      <ModalButton label="Edit" title={`Edit ${user.full_name}`} className="btn-ghost btn-sm" wide>
        {() => (
          <ActionForm action={updateUser}>
            <input type="hidden" name="id" value={user.id} />
            <Fields refs={refs} u={user} meRole={meRole} teamAccess={teamAccess} />
            <Submit>Save changes</Submit>
          </ActionForm>
        )}
      </ModalButton>
      {canManageAuth && <SetPassword user={user} />}
      {!user.email.includes("@users.") && <ActionButton action={() => sendPasswordReset(user.id)} confirm={`Send a password reset email to ${user.email}?`}>Email reset</ActionButton>}
      {canManageAuth && user.id !== meId && (user.is_active
        ? <ActionButton className="btn-sm btn border border-red-300 text-red-700 hover:bg-red-50" action={() => setUserActive(user.id, false)}
            confirm={`Deactivate ${user.full_name}? They will be signed out and blocked. Their leads stay assigned until you reassign them.`}>Deactivate</ActionButton>
        : <ActionButton action={() => setUserActive(user.id, true)} confirm={`Reactivate ${user.full_name}?`}>Activate</ActionButton>)}
    </div>
  );
}

const DAYS: [string, string][] = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
function WorkingHours({ value }: { value: Record<string, [string, string]> | null }) {
  const [mode, setMode] = useState(value ? "custom" : "any");
  return (
    <fieldset className="sm:col-span-2">
      <legend className="label">Working hours (IST) — used by smart allocation and SLA backup routing</legend>
      <div className="mb-2 flex gap-4 text-sm">
        <label className="flex items-center gap-1"><input type="radio" name="hours_mode" value="any" checked={mode === "any"} onChange={() => setMode("any")} /> Any time</label>
        <label className="flex items-center gap-1"><input type="radio" name="hours_mode" value="custom" checked={mode === "custom"} onChange={() => setMode("custom")} /> Set hours</label>
      </div>
      {mode === "custom" && (
        <div className="grid gap-1 sm:grid-cols-2">
          {DAYS.map(([d, l]) => (
            <div key={d} className="flex items-center gap-2 text-sm">
              <label className="flex w-16 items-center gap-1"><input type="checkbox" name={`wh_${d}`} defaultChecked={value ? !!value[d] : !["sun"].includes(d)} /> {l}</label>
              <input className="input w-28 py-1" type="time" name={`wh_${d}_from`} defaultValue={value?.[d]?.[0] ?? "09:30"} />
              <span>–</span>
              <input className="input w-28 py-1" type="time" name={`wh_${d}_to`} defaultValue={value?.[d]?.[1] ?? "18:30"} />
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
