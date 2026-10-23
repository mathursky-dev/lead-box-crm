"use client";
import { ActionForm, ActionButton, Field, Submit } from "@/components/ui";
import { suppression, removeSuppression, setConsent } from "@/lib/actions/nurture";

export function SuppressionForm() {
  return (
    <ActionForm action={suppression} resetOnOk className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="action" value="add" />
      <Field label="Phone"><input className="input" name="phone" required placeholder="+91…" /></Field>
      <Field label="Reason"><input className="input" name="reason" required placeholder="e.g. Asked not to be contacted" /></Field>
      <Submit>Suppress</Submit>
    </ActionForm>
  );
}

export function RemoveSuppression({ phone }: { phone: string }) {
  return <ActionButton action={() => removeSuppression(phone)} confirm={`Remove ${phone} from the suppression list? Automation may message them again if they have opted in.`}>Remove</ActionButton>;
}

export function ConsentForm({ customerId, optedIn, optedOut }: { customerId: string; optedIn: boolean; optedOut: boolean }) {
  return (
    <ActionForm action={setConsent} resetOnOk className="space-y-2">
      <input type="hidden" name="customer_id" value={customerId} />
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1"><input type="radio" name="status" value="opt_in" defaultChecked={!optedIn || optedOut} /> Opt-in</label>
        <label className="flex items-center gap-1"><input type="radio" name="status" value="opt_out" defaultChecked={optedIn && !optedOut} /> Opt-out</label>
      </div>
      <input className="input" name="note" required placeholder="How was consent given/withdrawn? (e.g. Website form 12 Oct, verbal on call)" />
      <Submit className="btn-ghost">Record consent</Submit>
    </ActionForm>
  );
}
