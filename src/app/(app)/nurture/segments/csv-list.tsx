"use client";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { importSegmentCsv } from "@/lib/actions/nurture";

export function CsvListForm({ canConsent }: { canConsent: boolean }) {
  return (
    <ModalButton label="Import CSV list" title="Audience from CSV" className="btn-ghost">
      {(close) => (
        <ActionForm action={importSegmentCsv} onOk={close}>
          <Field label="List name"><input className="input" name="name" required maxLength={80} /></Field>
          <Field label="CSV file" hint="Header row with a phone/mobile column (and optionally name). Indian numbers without +91 are accepted. Max 5000 rows.">
            <input className="input" type="file" name="file" accept=".csv,text/csv" required /></Field>
          {canConsent ? (
            <>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="opt_in" className="mt-1" /> These contacts gave WhatsApp opt-in. Record it (opted-out contacts are never changed).</label>
              <Field label="How was opt-in collected? (required if ticked)"><input className="input" name="note" placeholder="e.g. Website form checkbox, Oct 2026" /></Field>
            </>
          ) : <p className="text-xs text-slate-500">Contacts without recorded opt-in are skipped when a campaign sends.</p>}
          <Submit>Import</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}
