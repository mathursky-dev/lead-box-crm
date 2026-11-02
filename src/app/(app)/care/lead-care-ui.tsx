"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { ActionForm, Field, Modal, Submit } from "@/components/ui";
import { fmtDateTime, toLocalInput } from "@/lib/dates";
import { apptStatus, NPS_CLS, npsBucket, FEEDBACK_STATUS, nowMs } from "@/lib/care";
import { addReferrer, bookAppointment, createFeedbackLink, sendCareLink } from "@/lib/actions/care";

type Kind = "portal" | "booking" | "feedback" | "referral";

function LinkRow({ label, hint, url, kind, leadId, canSend, onCreate }: {
  label: string; hint: string; url: string | null; kind: Kind; leadId: string; canSend: boolean; onCreate?: () => Promise<{ error?: string; url?: string }>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>();
  const [link, setLink] = useState(url);
  const copy = (u: string) => navigator.clipboard?.writeText(u).then(() => setMsg({ ok: "Link copied." }));
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><div className="text-sm font-medium text-navy-900">{label}</div><div className="text-xs text-slate-500">{hint}</div></div>
        <div className="flex shrink-0 gap-1.5">
          {canSend && (
            <button type="button" className="btn-primary btn-sm" disabled={pending}
              onClick={() => start(async () => { const r = await sendCareLink(leadId, kind); if (r?.url) setLink(r.url); setMsg(r ?? undefined); })}>
              {pending ? "…" : "Send"}
            </button>
          )}
          <button type="button" className="btn-ghost btn-sm" disabled={pending}
            onClick={() => link ? copy(link) : onCreate && start(async () => { const r = await onCreate(); if (r.url) { setLink(r.url); copy(r.url); } else setMsg({ error: r.error }); })}>
            Copy
          </button>
        </div>
      </div>
      {msg?.error && <p className="mt-1 text-xs text-red-600">{msg.error}</p>}
      {msg?.ok && <p className="mt-1 text-xs text-brand-700">{msg.ok}</p>}
    </li>
  );
}

export function LeadCareUi({ leadId, canSend, canEdit, users, links, feedback, appts, referredBy, referredCount }: {
  leadId: string; canSend: boolean; canEdit: boolean; users: { id: string; name: string }[];
  links: { portal: string | null; booking: string | null; referral: string | null };
  feedback: { status: string; score: number | null; comment: string | null; url: string } | null;
  appts: { id: string; no: number; at: string; status: string }[];
  referredBy: string | null; referredCount: number;
}) {
  const [book, setBook] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const fbStatus = feedback ? FEEDBACK_STATUS[feedback.status] ?? FEEDBACK_STATUS.pending : null;
  const defaultWhen = toLocalInput(new Date(Math.ceil((nowMs() + 86400000) / 3600000) * 3600000).toISOString());
  return (
    <section className="card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">Customer care</h2>
        <Link href="/care/appointments" className="text-xs text-brand-700 hover:underline">Open</Link>
      </div>

      <div className="mb-2 rounded-lg bg-slate-50 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Appointments</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setBook(true)}>+ Book</button>
        </div>
        {appts.length ? (
          <ul className="mt-1 space-y-1 text-sm">
            {appts.map((a) => { const st = apptStatus(a.status); return (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <Link href={`/care/appointments?id=${a.id}`} className="text-navy-900 hover:text-brand-700">📅 {fmtDateTime(a.at)}</Link>
                <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span>
              </li>
            ); })}
          </ul>
        ) : <p className="mt-1 text-xs text-slate-500">None yet.</p>}
      </div>

      {feedback && (
        <div className="mb-2 rounded-lg bg-slate-50 p-2.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {feedback.score != null
              ? <span className={`rounded px-2 py-0.5 font-bold ${NPS_CLS[npsBucket(feedback.score)]}`}>{feedback.score}/10</span>
              : fbStatus && <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${fbStatus.cls}`}>{fbStatus.label}</span>}
            {feedback.comment && <span className="text-xs text-slate-600">“{feedback.comment}”</span>}
          </div>
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {links.portal && <LinkRow label="Customer portal" hint="Their quotes, invoices, orders & appointments" url={links.portal} kind="portal" leadId={leadId} canSend={canSend} />}
        {links.booking && <LinkRow label="Booking link" hint="Customer picks a free slot" url={links.booking} kind="booking" leadId={leadId} canSend={canSend} />}
        <LinkRow label={feedback?.score != null ? "Ask feedback again" : "Feedback / rating"} hint="0–10 rating + comment" url={feedback?.url ?? null} kind="feedback" leadId={leadId} canSend={canSend}
          onCreate={() => createFeedbackLink(leadId)} />
        {links.referral && <LinkRow label="Referral link" hint={referredCount ? `Referred ${referredCount} so far` : "Their personal link to refer friends"} url={links.referral} kind="referral" leadId={leadId} canSend={canSend} />}
      </ul>

      <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
        {referredBy ? <>🤝 Referred by <b>{referredBy}</b></> : canEdit ? <button type="button" className="text-brand-700 hover:underline" onClick={() => setRefOpen(true)}>+ Add “referred by”</button> : null}
      </div>

      <Modal open={book} onClose={() => setBook(false)} title="Book appointment">
        <ActionForm action={bookAppointment} onOk={() => setBook(false)}>
          <input type="hidden" name="lead_id" value={leadId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date & time (IST)"><input className="input" type="datetime-local" name="when" required defaultValue={defaultWhen} /></Field>
            <Field label="Duration (minutes)"><input className="input" type="number" name="minutes" min={5} max={600} defaultValue={30} /></Field>
          </div>
          <Field label="With" hint="Empty = lead owner">
            <select className="input" name="assign" defaultValue="">
              <option value="">Lead owner</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Note"><input className="input" name="note" maxLength={1000} placeholder="Site visit / demo / consultation" /></Field>
          {canSend && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send" defaultChecked /> Send confirmation on WhatsApp</label>}
          <Submit>Book</Submit>
        </ActionForm>
      </Modal>
      <Modal open={refOpen} onClose={() => setRefOpen(false)} title="Referred by">
        <ActionForm action={addReferrer} onOk={() => setRefOpen(false)}>
          <input type="hidden" name="lead_id" value={leadId} />
          <Field label="Referrer's mobile number" hint="Must be an existing customer in the CRM"><input className="input" name="phone" required inputMode="tel" placeholder="98xxxxxxxx" /></Field>
          <Submit>Save</Submit>
        </ActionForm>
      </Modal>
    </section>
  );
}
