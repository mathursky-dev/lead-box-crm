"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { submitOrderUtr } from "@/lib/actions/order-pay";

/** UPI QR + "open UPI app" button + UTR box for the public order page. */
export function UpiOrderPay({ token, link, upiId, upiName, amount, color, utr }: {
  token: string; link: string; upiId: string; upiName: string; amount: string; color: string; utr: string | null;
}) {
  const [qr, setQr] = useState("");
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>(utr ? { ok: `UTR ${utr} received. We will confirm shortly.` } : {});
  useEffect(() => {
    let live = true;
    QRCode.toString(link, { type: "svg", margin: 1, width: 200 }).then((s) => live && setQr(s)).catch(() => undefined);
    return () => { live = false; };
  }, [link]);
  return (
    <div className="space-y-3">
      <a href={link} className="block w-full rounded-lg px-4 py-3 text-center font-semibold text-white sm:hidden" style={{ background: color }}>Pay {amount} with UPI app</a>
      <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-3">
        <div className="text-xs text-slate-500">Scan with GPay, PhonePe, Paytm or any UPI app</div>
        <div className="h-[200px] w-[200px] [&>svg]:h-full [&>svg]:w-full" aria-label="UPI QR code" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="text-center text-sm"><b className="font-mono">{upiId}</b><div className="text-xs text-slate-500">{upiName}</div></div>
        <button type="button" className="text-xs underline" onClick={() => navigator.clipboard?.writeText(upiId)}>Copy UPI ID</button>
      </div>
      <form className="space-y-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        const r = await submitOrderUtr(token, val);
        setBusy(false); setMsg(r);
        if (r.ok) setVal("");
      }}>
        <label className="block text-xs text-slate-600" htmlFor="utr">Paid? Enter the 12-digit UTR / UPI Ref No.</label>
        <div className="flex gap-2">
          <input id="utr" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2" inputMode="numeric" maxLength={14} required value={val} onChange={(e) => setVal(e.target.value)} placeholder="123456789012" />
          <button className="rounded-lg px-4 py-2 font-medium text-white disabled:opacity-60" style={{ background: color }} disabled={busy}>{busy ? "…" : "I have paid"}</button>
        </div>
        {msg.ok && <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{msg.ok}</p>}
        {msg.error && <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{msg.error}</p>}
      </form>
    </div>
  );
}
