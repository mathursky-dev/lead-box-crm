"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { Modal, type FormState } from "@/components/ui";
import {
  cancelIrn, saveIrn, cancelPaymentLink, convertToInvoice, createPaymentLink, deleteQuote, markQuoteSent, refreshPaymentLink,
  sendPaymentLink, sendQuoteOnWhatsApp, setQuoteStatus,
} from "@/lib/actions/quotes";
import { inr, LINK_STATUS, type PayLink } from "@/lib/quotes";

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<FormState>();
  const router = useRouter();
  const run = (fn: () => Promise<FormState>) => start(async () => { const r = await fn(); setMsg(r); router.refresh(); });
  return { pending, msg, setMsg, run };
}

function Msg({ m }: { m: FormState }) {
  if (!m?.error && !m?.ok) return null;
  return <div role={m.error ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${m.error ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{m.error ?? m.ok}</div>;
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { window.prompt("Copy this link:", text); return false; }
}

/** Buttons on a quotation/invoice page. */
export function QuoteActions({ q, leadId, canSend, admin, payReady, shareUrl, hasInvoice, signUrl = null }: {
  q: { id: string; kind: string; status: string; total: number; amount_paid: number; doc_no: string };
  leadId: string; canSend: boolean; admin: boolean; payReady: boolean; shareUrl: string; hasInvoice: string | null; signUrl?: string | null;
}) {
  const { pending, msg, setMsg, run } = useRun();
  const router = useRouter();
  const closed = q.status === "cancelled" || q.status === "paid";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canSend && q.status !== "cancelled" && (
          <button className="btn-primary" disabled={pending} onClick={() => run(() => sendQuoteOnWhatsApp(q.id))}><Icon name="send" /> {pending ? "Sending…" : "Send on WhatsApp"}</button>
        )}
        <a className="btn-ghost" href={`/api/quotes/${q.id}/pdf?download=1`}><Icon name="download" /> Download PDF</a>
        <button className="btn-ghost" onClick={async () => setMsg({ ok: (await copy(shareUrl)) ? "Share link copied." : "Share link shown." })}><Icon name="link" /> Copy share link</button>
        {signUrl && <button className="btn-ghost" onClick={async () => setMsg({ ok: (await copy(signUrl)) ? "Sign link copied. Send it to the customer to accept & sign online." : "Sign link shown." })}><Icon name="pencil" /> Copy sign link</button>}
        {!closed && <Link className="btn-ghost" href={`/quotes/${q.id}/edit`}><Icon name="pencil" /> Edit</Link>}
        {!closed && payReady && q.total > q.amount_paid && (
          <PayLinkButton leadId={leadId} quoteId={q.id} amount={Math.round((q.total - q.amount_paid) * 100) / 100} description={`Payment for ${q.doc_no}`} canSend={canSend} />
        )}
        {q.kind === "quotation" && q.status !== "cancelled" && (hasInvoice
          ? <Link className="btn-ghost" href={`/quotes/${hasInvoice}`}>Open invoice</Link>
          : <button className="btn-ghost" disabled={pending} onClick={() => run(async () => {
              const r = await convertToInvoice(q.id);
              if (r.id) router.push(`/quotes/${r.id}`);
              return r.error ? { error: r.error } : undefined;
            })}>Convert to invoice</button>)}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {q.status === "draft" && <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => markQuoteSent(q.id))}>Mark as sent (shared another way)</button>}
        {q.kind === "quotation" && ["draft", "sent"].includes(q.status) && <>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => setQuoteStatus(q.id, "accepted"))}>Customer accepted</button>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => setQuoteStatus(q.id, "rejected"))}>Customer rejected</button>
        </>}
        {!closed && q.amount_paid === 0 && <button className="btn-ghost btn-sm text-red-600" disabled={pending}
          onClick={() => confirm(`Cancel ${q.doc_no}?`) && run(() => setQuoteStatus(q.id, "cancelled"))}>Cancel</button>}
        {(q.status === "draft" || admin) && q.amount_paid === 0 && <button className="btn-ghost btn-sm text-red-600" disabled={pending}
          onClick={() => confirm(`Delete ${q.doc_no}? This can't be undone.`) && run(async () => { const r = await deleteQuote(q.id); if (!r?.error) router.push(`/leads/${leadId}`); return r; })}>Delete</button>}
      </div>
      <Msg m={msg} />
    </div>
  );
}

/** "Payment link" button + modal: amount, description, send on WhatsApp now. */
export function PayLinkButton({ leadId, quoteId, amount, description, canSend, className = "btn-ghost", label = "Payment link", onDone }: {
  leadId: string; quoteId?: string | null; amount?: number; description?: string; canSend: boolean; className?: string; label?: React.ReactNode; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label === "Payment link" ? <><Icon name="rupee" /> Payment link</> : label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Razorpay payment link">
        {open && <PayLinkForm leadId={leadId} quoteId={quoteId} amount={amount} description={description} canSend={canSend} onDone={() => { onDone?.(); }} />}
      </Modal>
    </>
  );
}

function PayLinkForm({ leadId, quoteId, amount, description, canSend, onDone }: {
  leadId: string; quoteId?: string | null; amount?: number; description?: string; canSend: boolean; onDone: () => void;
}) {
  const [amt, setAmt] = useState(amount ? String(amount) : "");
  const [desc, setDesc] = useState(description ?? "");
  const [send, setSend] = useState(canSend);
  const [res, setRes] = useState<{ url?: string; error?: string; note?: string }>();
  const [pending, start] = useTransition();
  const router = useRouter();
  if (res?.url) {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-brand-50 px-3 py-2 text-brand-700">{res.note}</div>
        {res.error && <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">{res.error}</div>}
        <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={res.url} aria-label="Payment link" />
          <button className="btn-ghost" onClick={() => copy(res.url!)}>Copy</button></div>
        <p className="text-xs text-slate-500">When the customer pays, the lead is marked paid (and Won, if that is on in Settings) automatically.</p>
      </div>
    );
  }
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await createPaymentLink({ lead_id: leadId, quote_id: quoteId ?? null, amount: Number(amt), description: desc, send });
        if (r.error) { setRes({ error: r.error }); return; }
        setRes({ url: r.url, note: r.sent ? "Link created and sent on WhatsApp." : "Link created.", error: r.warn });
        onDone(); router.refresh();
      });
    }}>
      <label className="block"><span className="label">Amount (₹)</span>
        <input className="input" type="number" min={1} step="0.01" required value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus /></label>
      <label className="block"><span className="label">What is it for?</span>
        <input className="input" maxLength={200} placeholder="e.g. Advance for order" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      {canSend && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> Send on WhatsApp now</label>}
      {res?.error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{res.error}</div>}
      <div className="flex justify-end"><button className="btn-primary" disabled={pending}>{pending ? "Creating…" : "Create link"}</button></div>
    </form>
  );
}

/** One payment link row with its actions. */
export function PayLinkRow({ l, canSend }: { l: PayLink; canSend: boolean }) {
  const { pending, msg, run } = useRun();
  const st = LINK_STATUS[l.status];
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-navy-900">{inr(l.amount)} <span className={`ml-1 rounded px-1.5 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span></div>
          <div className="truncate text-xs text-slate-500">{l.description}{l.sent_at ? " · sent" : ""}{l.paid_at ? ` · paid ${new Date(l.paid_at).toLocaleDateString("en-IN")}` : ""}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {l.short_url && l.status === "created" && <>
            <button className="btn-ghost btn-sm" onClick={() => copy(l.short_url!)}>Copy</button>
            {canSend && <button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => sendPaymentLink(l.id))}>{l.sent_at ? "Resend" : "Send"}</button>}
            <button className="btn-ghost btn-sm" disabled={pending} title="Check status with Razorpay" onClick={() => run(() => refreshPaymentLink(l.id))}><Icon name="refresh" /></button>
            <button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => confirm("Cancel this payment link?") && run(() => cancelPaymentLink(l.id))}>✕</button>
          </>}
        </div>
      </div>
      <Msg m={msg} />
    </li>
  );
}

/** e-Invoice box on an invoice: paste IRN / Ack / signed QR after registering on the IRP. */
export function IrnBox({ id, irn, ackNo, ackDate, cancelled, problems, admin }: {
  id: string; irn: string | null; ackNo: string | null; ackDate: string | null; cancelled: boolean; problems: string[]; admin: boolean;
}) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ irn: "", ack_no: "", ack_date: "", signed_qr: "" });
  return (
    <section className="card space-y-2 p-4 text-sm">
      <h2 className="text-sm font-semibold text-navy-900">e-Invoice (IRN)</h2>
      {irn && !cancelled ? (
        <>
          <div className="break-all font-mono text-xs text-slate-700">{irn}</div>
          {ackNo && <div className="text-xs text-slate-500">Ack {ackNo}{ackDate ? ` · ${new Date(ackDate).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}</div>}
          {admin && <button className="btn-ghost btn-sm text-red-600" disabled={pending} onClick={() => confirm("Mark this IRN cancelled? Cancel it on the e-invoice portal first (allowed within 24 hours).") && run(() => cancelIrn(id))}>Mark IRN cancelled</button>}
        </>
      ) : (
        <>
          {cancelled && irn && <p className="text-xs text-amber-700">IRN {irn.slice(0, 12)}… was cancelled.</p>}
          {problems.length ? (
            <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Not ready for e-invoice:</b><ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
          ) : admin && (
            <a className="btn-ghost btn-sm" href={`/api/gst/einvoice?id=${id}`}><Icon name="download" /> e-Invoice JSON</a>
          )}
          {admin && (open ? (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => saveIrn(id, f)); }}>
              <input className="input font-mono text-xs" placeholder="IRN (64 characters)" required value={f.irn} onChange={(e) => setF({ ...f, irn: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input text-xs" placeholder="Ack no." value={f.ack_no} onChange={(e) => setF({ ...f, ack_no: e.target.value })} />
                <input className="input text-xs" type="datetime-local" aria-label="Ack date" value={f.ack_date} onChange={(e) => setF({ ...f, ack_date: e.target.value })} />
              </div>
              <textarea className="input min-h-16 font-mono text-[11px]" placeholder="Signed QR code text (optional, prints the QR on the PDF)" value={f.signed_qr} onChange={(e) => setF({ ...f, signed_qr: e.target.value })} />
              <button className="btn-primary btn-sm" disabled={pending}>{pending ? "Saving…" : "Save IRN"}</button>
            </form>
          ) : <button className="btn-ghost btn-sm" onClick={() => setOpen(true)}>Enter IRN details</button>)}
        </>
      )}
      <Msg m={msg} />
    </section>
  );
}
