"use client";
import { ActionForm, Submit } from "@/components/ui";
import { reviewTopup, saveUpiSettings } from "@/lib/actions/platform";

export function UpiForm({ upiId, upiName }: { upiId: string | null; upiName: string | null }) {
  return (
    <ActionForm action={saveUpiSettings} className="flex flex-wrap items-end gap-2">
      <label className="min-w-56 flex-1"><span className="label">UPI ID (payments go here)</span>
        <input className="input" name="upi_id" defaultValue={upiId ?? ""} required placeholder="leadbox@okhdfcbank" maxLength={320} /></label>
      <label className="min-w-48 flex-1"><span className="label">Payee name</span>
        <input className="input" name="upi_name" defaultValue={upiName ?? ""} required placeholder="Lead Box" maxLength={80} /></label>
      <Submit className="btn-primary">Save</Submit>
    </ActionForm>
  );
}

export function ReviewForm({ id, amount }: { id: string; amount: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={reviewTopup} className="space-y-1" confirm={`Credit ${amount} to this company's wallet? Only approve after you see the UTR in your bank statement.`}>
        <input type="hidden" name="id" value={id} /><input type="hidden" name="approve" value="1" />
        <Submit className="btn-primary btn-sm" pendingText="…">Approve</Submit>
      </ActionForm>
      <ActionForm action={reviewTopup} className="flex flex-wrap items-start gap-1">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="approve" value="0" />
        <input className="input h-8 w-40 py-1 text-xs" name="note" placeholder="Reason (if rejecting)" maxLength={300} />
        <Submit className="btn-ghost btn-sm" pendingText="…">Reject</Submit>
      </ActionForm>
    </div>
  );
}
