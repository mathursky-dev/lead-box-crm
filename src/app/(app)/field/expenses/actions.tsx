"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewExpenses, deleteExpense } from "@/lib/actions/field";
import { rupees } from "@/lib/field";

export function ExpenseActions({ id, canReview, canPay, canDelete }: { id: string; status: string; canReview: boolean; canPay: boolean; canDelete: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.error ?? null);
    if (!r.error) router.refresh();
  });
  if (!canReview && !canPay && !canDelete) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {canReview && <>
          <button className="btn-primary btn-sm" disabled={pending} onClick={() => run(() => reviewExpenses([id], "approved", window.prompt("Note for the claimant (optional)") ?? ""))}>Approve</button>
          <button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => {
            const note = window.prompt("Why is it rejected?");
            if (note === null) return;
            run(() => reviewExpenses([id], "rejected", note));
          }}>Reject</button>
        </>}
        {canPay && <button className="btn-navy btn-sm" disabled={pending} onClick={() => { if (window.confirm("Mark this expense as paid?")) run(() => reviewExpenses([id], "paid")); }}>Mark paid</button>}
        {canDelete && <button className="btn-ghost btn-sm" disabled={pending} onClick={() => { if (window.confirm("Delete this claim?")) run(() => deleteExpense(id)); }}>Delete</button>}
      </div>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}

export function BulkApprove({ ids, total }: { ids: string[]; total: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <span>{ids.length} pending claims you can approve · <b>{rupees(total)}</b></span>
      <span className="flex items-center gap-2">
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
        <button className="btn-primary btn-sm" disabled={pending} onClick={() => {
          if (!window.confirm(`Approve all ${ids.length} claims (${rupees(total)})?`)) return;
          start(async () => { const r = await reviewExpenses(ids, "approved"); setMsg(r.error ?? r.ok ?? null); router.refresh(); });
        }}>Approve all shown</button>
      </span>
    </div>
  );
}
