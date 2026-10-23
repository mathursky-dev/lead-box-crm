"use client";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { createTemplate, syncTemplates } from "@/lib/actions/whatsapp";

export function TemplateForm({ numbers }: { numbers: { id: string; label: string }[] }) {
  return (
    <ModalButton label="+ New template" title="Submit a template to Meta" wide>
      {(close) => (
        <ActionForm action={createTemplate} onOk={close}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business number (its WABA)"><select className="input" name="number_id" required>{numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
            <Field label="Name" hint="lowercase_with_underscores"><input className="input font-mono" name="name" required pattern="[a-z0-9_]+" /></Field>
            <Field label="Language code" hint="e.g. en, en_US, hi"><input className="input" name="language" defaultValue="en" required /></Field>
            <Field label="Category" hint="Utility = order/payment/account updates. Marketing = offers, reminders to buy."><select className="input" name="category"><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option></select></Field>
            <Field label="Header (optional text, max 60)"><input className="input" name="header" maxLength={60} /></Field>
            <Field label="Header sample (if header uses {{1}})"><input className="input" name="header_example" maxLength={60} /></Field>
          </div>
          <Field label="Body" hint="Use {{1}}, {{2}}… for personalised values."><textarea className="input min-h-28" name="body" required maxLength={1024} /></Field>
          <Field label="Sample values for body variables" hint="One per line, in order — Meta requires examples."><textarea className="input min-h-16" name="examples" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Footer (optional)"><input className="input" name="footer" maxLength={60} /></Field>
            <Field label="Quick-reply buttons (optional)" hint="Up to 3, one per line, e.g. STOP"><textarea className="input min-h-16" name="quick_replies" /></Field>
            <Field label="Link button text (optional)"><input className="input" name="url_text" maxLength={25} /></Field>
            <Field label="Link button URL"><input className="input" name="url" type="url" placeholder="https://" /></Field>
          </div>
          <p className="text-xs text-slate-500">Marketing templates should offer an opt-out (e.g. a “STOP” quick reply). Status updates arrive automatically when the webhook is subscribed to “message_template_status_update”; otherwise use Sync.</p>
          <Submit>Submit for review</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function SyncButton({ id, label }: { id: string; label: string }) {
  return <ActionButton action={() => syncTemplates(id)}>Sync {label}</ActionButton>;
}
