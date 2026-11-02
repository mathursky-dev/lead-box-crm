"use client";
import { useState } from "react";
import { ActionButton, ActionForm, Submit } from "@/components/ui";
import { disconnectGmail, sendLeadEmail, syncMyGmail } from "@/lib/actions/email";

export function GmailButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton action={syncMyGmail} className="btn-primary btn-sm">Sync now</ActionButton>
      <ActionButton action={disconnectGmail} className="btn-ghost btn-sm text-red-600" confirm="Disconnect your Gmail? New mails stop coming in. Mails already on leads stay.">Disconnect</ActionButton>
    </div>
  );
}

export function EmailCompose({ leadId, to, reply }: { leadId: string; to: string; reply?: { subject: string; threadId: string | null } }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>✉ Write email</button>;
  const subject = reply ? (/^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`) : "";
  return (
    <ActionForm action={sendLeadEmail} onOk={() => setOpen(false)} className="space-y-2 rounded-md border border-slate-200 p-3">
      <input type="hidden" name="lead_id" value={leadId} />
      {reply?.threadId && <input type="hidden" name="thread_id" value={reply.threadId} />}
      <div className="text-xs text-slate-500">To {to}</div>
      <input className="input" name="subject" required maxLength={300} defaultValue={subject} placeholder="Subject" />
      <textarea className="input" name="body" rows={5} required maxLength={20000} placeholder="Write your email" />
      <div className="flex gap-2">
        <Submit pendingText="Sending…">Send from my Gmail</Submit>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </ActionForm>
  );
}
