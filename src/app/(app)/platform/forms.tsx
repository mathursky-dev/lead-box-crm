"use client";
import { useState } from "react";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import {
  createCompany, savePlan, setCompanyPlan, setTrial, recordManualPayment, setSuspended, setInternal, walletCredit, saveNotes, setTenantPassword,
} from "@/lib/actions/platform";

type PlanOpt = { id: string; name: string; trial_days: number; period_days: number };
type PlanRow = {
  id: string; code: string; name: string; description: string | null; price_inr: number; per_user: boolean; period_days: number; trial_days: number;
  max_users: number | null; max_numbers: number | null; max_leads_month: number | null; features: string[]; is_public: boolean; is_active: boolean; sort: number;
};

export function AddCompanyButton({ plans }: { plans: PlanOpt[] }) {
  return (
    <ModalButton label="+ Add company" title="Add a company">
      {() => <AddCompanyForm plans={plans} />}
    </ModalButton>
  );
}

function AddCompanyForm({ plans }: { plans: PlanOpt[] }) {
  const [status, setStatus] = useState<"trial" | "paid" | "internal">("trial");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const plan = plans.find((p) => p.id === planId);
  return (
    <ActionForm action={createCompany} resetOnOk>
      <Field label="Company name"><input className="input" name="company" required maxLength={120} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Admin name"><input className="input" name="name" required maxLength={120} /></Field>
        <Field label="Admin mobile"><input className="input" name="phone" type="tel" placeholder="+91 98765 43210" /></Field>
      </div>
      <Field label="Admin email (login)"><input className="input" name="email" type="email" required autoCapitalize="none" spellCheck={false} /></Field>
      <Field label="Password" hint="Leave empty to generate one; it is shown once after saving."><input className="input" name="password" type="text" minLength={8} autoComplete="off" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Plan">
          <select className="input" name="plan_id" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Start as">
          <select className="input" name="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="trial">Free trial</option><option value="paid">Paid</option><option value="internal">Free forever</option>
          </select>
        </Field>
        {status !== "internal" && (
          <Field label={status === "trial" ? "Trial days" : "Paid days"}>
            <input className="input" name="days" type="number" min={1} max={3660} key={`${status}-${planId}`}
              defaultValue={status === "trial" ? plan?.trial_days || 7 : plan?.period_days ?? 30} />
          </Field>
        )}
      </div>
      <Submit pendingText="Creating…">Create company</Submit>
    </ActionForm>
  );
}

export function PlanButton({ plan, features }: { plan?: PlanRow; features: Record<string, string> }) {
  return (
    <ModalButton label={plan ? "Edit" : "+ New plan"} title={plan ? `Edit ${plan.name}` : "New plan"} className={plan ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {() => (
        <ActionForm action={savePlan} resetOnOk={!plan}>
          <input type="hidden" name="id" value={plan?.id ?? ""} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><input className="input" name="name" defaultValue={plan?.name} required maxLength={60} /></Field>
            <Field label="Code" hint="Short id, e.g. growth"><input className="input" name="code" defaultValue={plan?.code} required pattern="[a-z0-9-]{2,40}" /></Field>
            <Field label="Sort order"><input className="input" name="sort" type="number" defaultValue={plan?.sort ?? 0} /></Field>
          </div>
          <Field label="Short description"><input className="input" name="description" defaultValue={plan?.description ?? ""} maxLength={300} /></Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Price (₹)"><input className="input" name="price_inr" type="number" min={0} defaultValue={plan?.price_inr ?? 0} required /></Field>
            <Field label="Billing period (days)" hint="30 = monthly, 365 = yearly"><input className="input" name="period_days" type="number" min={1} max={3660} defaultValue={plan?.period_days ?? 30} required /></Field>
            <Field label="Free trial (days)"><input className="input" name="trial_days" type="number" min={0} max={90} defaultValue={plan?.trial_days ?? 7} required /></Field>
            <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" name="per_user" defaultChecked={plan?.per_user ?? true} /> Price per user</label>
          </div>
          <p className="text-xs text-slate-500">Limits: leave empty for unlimited.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Max active users"><input className="input" name="max_users" type="number" min={1} defaultValue={plan?.max_users ?? ""} /></Field>
            <Field label="Max WhatsApp numbers"><input className="input" name="max_numbers" type="number" min={0} defaultValue={plan?.max_numbers ?? ""} /></Field>
            <Field label="Leads per month" hint="Shown as usage; leads are never blocked"><input className="input" name="max_leads_month" type="number" min={1} defaultValue={plan?.max_leads_month ?? ""} /></Field>
          </div>
          <fieldset>
            <legend className="label">Included features</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {Object.entries(features).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" name={`f_${k}`} defaultChecked={plan ? plan.features.includes(k) : true} /> {label}</label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="is_public" defaultChecked={plan?.is_public ?? true} /> Show on signup & billing pages</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={plan?.is_active ?? true} /> Active</label>
          </div>
          <Submit>{plan ? "Save plan" : "Create plan"}</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

const Hidden = ({ id }: { id: string }) => <input type="hidden" name="company_id" value={id} />;

export function ChangePlanForm({ companyId, plans, current }: { companyId: string; plans: PlanOpt[]; current: string | null }) {
  return (
    <ActionForm action={setCompanyPlan} className="flex flex-wrap items-end gap-2">
      <Hidden id={companyId} />
      <label className="min-w-40 flex-1"><span className="label">Plan</span>
        <select className="input" name="plan_id" defaultValue={current ?? ""} required>
          <option value="" disabled>Choose…</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <Submit className="btn-ghost">Change plan</Submit>
    </ActionForm>
  );
}

export function TrialForm({ companyId }: { companyId: string }) {
  return (
    <ActionForm action={setTrial} className="flex flex-wrap items-end gap-2" confirm="Change this company's trial end date?">
      <Hidden id={companyId} />
      <label className="w-40"><span className="label">Trial ends in (days)</span><input className="input" name="days" type="number" min={0} max={365} defaultValue={7} required /></label>
      <Submit className="btn-ghost">Set trial</Submit>
    </ActionForm>
  );
}

export function ManualPaymentButton({ companyId, seats, suggested, days }: { companyId: string; seats: number; suggested: number; days: number }) {
  return (
    <ModalButton label="Record payment" title="Record a payment received" className="btn-primary">
      {() => (
        <ActionForm action={recordManualPayment} resetOnOk>
          <Hidden id={companyId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount (₹)"><input className="input" name="amount" type="number" min={0} step="0.01" defaultValue={suggested} required /></Field>
            <Field label="Access days"><input className="input" name="days" type="number" min={1} max={3660} defaultValue={days} required /></Field>
            <Field label="Users billed"><input className="input" name="seats" type="number" min={1} defaultValue={seats} required /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Method">
              <select className="input" name="method"><option value="upi">UPI</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select>
            </Field>
            <Field label="Reference" hint="UTR / receipt number"><input className="input" name="reference" required maxLength={120} /></Field>
          </div>
          <Submit pendingText="Recording…">Record & extend access</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function SuspendForm({ companyId, suspended }: { companyId: string; suspended: boolean }) {
  return suspended ? (
    <ActionForm action={setSuspended} confirm="Activate this company again?">
      <Hidden id={companyId} /><input type="hidden" name="suspend" value="0" />
      <Submit className="btn-primary">Activate company</Submit>
    </ActionForm>
  ) : (
    <ActionForm action={setSuspended} className="flex flex-wrap items-end gap-2" confirm="Suspend this company? Its users will be locked out until you activate it. No data is deleted.">
      <Hidden id={companyId} /><input type="hidden" name="suspend" value="1" />
      <label className="min-w-40 flex-1"><span className="label">Reason (optional)</span><input className="input" name="reason" maxLength={300} placeholder="e.g. payment overdue" /></label>
      <Submit className="btn-ghost text-red-600">Suspend</Submit>
    </ActionForm>
  );
}

export function InternalForm({ companyId, internal }: { companyId: string; internal: boolean }) {
  return (
    <ActionForm action={setInternal} confirm={internal ? "Put this company back on normal billing?" : "Give this company free unlimited access with no expiry?"}>
      <Hidden id={companyId} /><input type="hidden" name="internal" value={internal ? "0" : "1"} />
      <Submit className="btn-ghost btn-sm">{internal ? "Back to normal billing" : "Make free forever"}</Submit>
    </ActionForm>
  );
}

export function WalletForm({ companyId }: { companyId: string }) {
  return (
    <ActionForm action={walletCredit} resetOnOk className="flex flex-wrap items-end gap-2">
      <Hidden id={companyId} />
      <label className="w-32"><span className="label">Amount (₹)</span><input className="input" name="amount" type="number" min={1} step="0.01" required /></label>
      <label className="min-w-40 flex-1"><span className="label">Payment reference</span><input className="input" name="reference" required maxLength={120} /></label>
      <Submit className="btn-ghost">Add to wallet</Submit>
    </ActionForm>
  );
}

export function NotesForm({ companyId, notes }: { companyId: string; notes: string | null }) {
  return (
    <ActionForm action={saveNotes}>
      <Hidden id={companyId} />
      <textarea className="input min-h-24" name="notes" defaultValue={notes ?? ""} maxLength={4000} placeholder="Deal details, contact person, renewal reminders…" />
      <Submit className="btn-ghost btn-sm">Save notes</Submit>
    </ActionForm>
  );
}

export function PasswordButton({ companyId, userId, name }: { companyId: string; userId: string; name: string }) {
  return (
    <ModalButton label="Set password" title={`New password for ${name}`} className="btn-ghost btn-sm">
      {() => (
        <ActionForm action={setTenantPassword} resetOnOk>
          <Hidden id={companyId} /><input type="hidden" name="user_id" value={userId} />
          <Field label="New password" hint="At least 8 characters. Share it securely."><input className="input" name="password" type="text" minLength={8} required autoComplete="off" /></Field>
          <Submit>Update password</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}
