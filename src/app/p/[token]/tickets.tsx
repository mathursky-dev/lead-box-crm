"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portalTicket, portalTicketReply } from "@/lib/actions/public-care";

export function RaiseTicket({ token, categories }: { token: string; categories: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>();
  if (!open) return (
    <div>
      {msg?.ok && <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg.ok}</p>}
      <button type="button" onClick={() => { setOpen(true); setMsg(undefined); }} className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700">Raise a complaint / service request</button>
    </div>
  );
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      start(async () => {
        const r = await portalTicket(token, { subject: String(f.get("subject") ?? ""), description: String(f.get("description") ?? ""), category: String(f.get("category") ?? ""), website: String(f.get("website") ?? "") });
        if (r.error) setMsg({ error: r.error });
        else { setMsg({ ok: `Thank you! Your request is registered${r.no ? ` (ticket TK-${r.no})` : ""}. We will get back to you soon.` }); setOpen(false); router.refresh(); }
      });
    }}>
      <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />
      {categories.length > 0 && (
        <select name="category" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" defaultValue="" aria-label="Category">
          <option value="">Type of problem…</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <input name="subject" required maxLength={200} placeholder="What is the problem?" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <textarea name="description" rows={3} maxLength={4000} placeholder="Details (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      {msg?.error && <p className="text-sm text-red-600">{msg.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Sending…" : "Submit"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600">Cancel</button>
      </div>
    </form>
  );
}

export function TicketReplyBox({ token, ticketId }: { token: string; ticketId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-emerald-700 underline">Reply</button>;
  return (
    <form className="mt-2 space-y-1.5" onSubmit={(e) => {
      e.preventDefault();
      const body = String(new FormData(e.currentTarget).get("body") ?? "");
      start(async () => {
        const r = await portalTicketReply(token, ticketId, body);
        if (r.error) setErr(r.error); else { setOpen(false); setErr(undefined); router.refresh(); }
      });
    }}>
      <textarea name="body" rows={2} required maxLength={4000} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Your message" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{pending ? "Sending…" : "Send"}</button>
    </form>
  );
}
