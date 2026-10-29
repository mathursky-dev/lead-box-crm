"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ActionForm, Submit } from "@/components/ui";
import { requestTopup } from "@/lib/actions/wallet";
import { TOPUP_MAX, TOPUP_MIN, upiLink, type Upi } from "@/lib/upi";

const PRESETS = [1000, 2000, 5000, 10000];

/** Step 1: pick an amount and pay by UPI (QR or app link). Step 2: submit the UTR. */
export function AddBalance({ upi, note }: { upi: Upi; note: string }) {
  const [amount, setAmount] = useState(1000);
  const [qr, setQr] = useState("");
  const valid = amount >= TOPUP_MIN && amount <= TOPUP_MAX;
  const link = valid ? upiLink(upi, amount, note) : "";

  useEffect(() => {
    let live = true;
    if (!link) { setQr(""); return; }
    QRCode.toString(link, { type: "svg", margin: 1, width: 200 }).then((s) => live && setQr(s)).catch(() => live && setQr(""));
    return () => { live = false; };
  }, [link]);

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_auto]">
      <div className="space-y-4">
        <div>
          <span className="label">1. Amount (₹)</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((v) => (
              <button key={v} type="button" onClick={() => setAmount(v)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${amount === v ? "border-transparent bg-brand-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                ₹{v.toLocaleString("en-IN")}
              </button>
            ))}
          </div>
          <input className="input w-40" type="number" min={TOPUP_MIN} max={TOPUP_MAX} step={1} value={amount || ""}
            onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))} aria-label="Amount in rupees" />
          {!valid && <p className="mt-1 text-xs text-red-600">Enter between ₹{TOPUP_MIN} and ₹{TOPUP_MAX.toLocaleString("en-IN")}.</p>}
        </div>

        <div>
          <span className="label">2. Pay by UPI</span>
          <p className="text-sm text-slate-600">
            Pay to <b className="text-navy-900">{upi.id}</b> ({upi.name}). On your phone tap the button; on a computer scan the QR with any UPI app.
          </p>
          <a href={link || undefined} aria-disabled={!valid}
            className={`btn-primary mt-2 inline-flex md:hidden ${valid ? "" : "pointer-events-none opacity-50"}`}>
            Pay ₹{(valid ? amount : 0).toLocaleString("en-IN")} in UPI app
          </a>
        </div>

        <ActionForm action={requestTopup} resetOnOk className="space-y-2">
          <span className="label">3. Enter the UTR after paying</span>
          <input type="hidden" name="amount" value={amount} />
          <div className="flex flex-wrap items-start gap-2">
            <input className="input w-56" name="utr" required inputMode="numeric" autoComplete="off" maxLength={14}
              placeholder="12-digit UTR / UPI Ref No." pattern="[0-9 ]{12,14}" title="12-digit UTR from your UPI app" />
            <Submit pendingText="Submitting…">I have paid ₹{(valid ? amount : 0).toLocaleString("en-IN")}</Submit>
          </div>
          <p className="text-xs text-slate-500">Find it in your UPI app under the payment details (UPI Ref No. / UTR / Transaction ID).</p>
        </ActionForm>
      </div>

      <div className="flex flex-col items-center justify-start gap-2 max-md:hidden">
        <div className="grid h-[200px] w-[200px] place-items-center rounded-lg border border-slate-200 bg-white p-1">
          {qr ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} /> : <span className="text-xs text-slate-400">Enter an amount</span>}
        </div>
        <span className="text-xs text-slate-500">Scan to pay ₹{(valid ? amount : 0).toLocaleString("en-IN")}</span>
      </div>
    </div>
  );
}
