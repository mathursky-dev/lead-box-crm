"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ActionForm, Submit } from "@/components/ui";
import { submitPlanUpi } from "@/lib/actions/billing";
import { upiLink, type Upi } from "@/lib/upi";

type PlanOpt = { id: string; name: string; amount: number; label: string };

/** Pay the plan amount to the platform UPI ID, then submit the UTR for verification. */
export function UpiPlanPay({ upi, plans, selected, company }: { upi: Upi; plans: PlanOpt[]; selected?: string; company: string }) {
  const [planId, setPlanId] = useState(selected && plans.some((p) => p.id === selected) ? selected : plans[0]?.id);
  const [qr, setQr] = useState("");
  const plan = plans.find((p) => p.id === planId);
  const link = plan ? upiLink(upi, plan.amount, `Lead Box ${plan.name} ${company}`.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 50)) : "";

  useEffect(() => {
    let live = true;
    if (!link) { setQr(""); return; }
    QRCode.toString(link, { type: "svg", margin: 1, width: 180 }).then((s) => live && setQr(s)).catch(() => live && setQr(""));
    return () => { live = false; };
  }, [link]);

  if (!plans.length) return null;
  const amt = plan ? `₹${plan.amount.toLocaleString("en-IN")}` : "";
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3">
      <div className="text-sm font-semibold text-navy-900">Pay by UPI (GPay, PhonePe, Paytm)</div>
      {plans.length > 1 && (
        <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · ₹{p.amount.toLocaleString("en-IN")} ({p.label})</option>)}
        </select>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2 text-sm text-slate-600">
          <p>1. Pay <b className="text-navy-900">{amt}</b> to <b className="text-navy-900">{upi.id}</b> ({upi.name}). Scan the QR, or on your phone tap the button.</p>
          <a href={link || undefined} className="btn-ghost btn-sm inline-flex sm:hidden">Pay {amt} in UPI app</a>
          <p>2. Enter the 12-digit UTR from your UPI app. Your plan starts once we verify it.</p>
          <ActionForm action={submitPlanUpi} resetOnOk className="space-y-2">
            <input type="hidden" name="plan_id" value={planId ?? ""} />
            <input className="input" name="utr" required inputMode="numeric" autoComplete="off" maxLength={14}
              placeholder="12-digit UTR / UPI Ref No." pattern="[0-9 ]{12,14}" title="12-digit UTR from your UPI app" />
            <Submit className="btn-primary w-full" pendingText="Submitting…">I have paid {amt}</Submit>
          </ActionForm>
        </div>
        <div className="grid h-[180px] w-[180px] shrink-0 place-items-center rounded-lg border border-slate-200 bg-white p-1 max-sm:hidden">
          {qr ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} /> : <span className="text-xs text-slate-400">…</span>}
        </div>
      </div>
    </div>
  );
}
