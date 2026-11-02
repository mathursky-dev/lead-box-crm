"use client";
import { ActionForm, Submit } from "@/components/ui";
import { reviewPlanPayment } from "@/lib/actions/platform";

export function PlanReviewForm({ id, amount }: { id: string; amount: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={reviewPlanPayment} className="space-y-1" confirm={`Activate the plan for ${amount}? Only approve after you see the UTR in your bank statement.`}>
        <input type="hidden" name="id" value={id} /><input type="hidden" name="approve" value="1" />
        <Submit className="btn-primary btn-sm" pendingText="…">Approve</Submit>
      </ActionForm>
      <ActionForm action={reviewPlanPayment} className="flex flex-wrap items-start gap-1">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="approve" value="0" />
        <input className="input h-8 w-40 py-1 text-xs" name="note" placeholder="Reason (if rejecting)" maxLength={300} />
        <Submit className="btn-ghost btn-sm" pendingText="…">Reject</Submit>
      </ActionForm>
    </div>
  );
}
