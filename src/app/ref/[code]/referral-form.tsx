"use client";
import { useState, useTransition } from "react";
import { submitReferral } from "@/lib/actions/public-care";

export function ReferralForm({ code }: { code: string }) {
  const [form, setForm] = useState({ name: "", phone: "", note: "", website: "" });
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</div>
        <h2 className="text-lg font-bold text-slate-900">Thank you!</h2>
        <p className="mt-2 text-sm text-slate-600">Our team will contact you shortly on WhatsApp.</p>
      </div>
    );
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    start(async () => {
      const r = await submitReferral(code, form);
      if (r.error) setError(r.error); else setDone(true);
    });
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <input className="input" placeholder="Your name" required maxLength={120} value={form.name} onChange={set("name")} />
      <input className="input" placeholder="Your WhatsApp number" required inputMode="tel" maxLength={20} value={form.phone} onChange={set("phone")} />
      <textarea className="input" placeholder="What are you looking for? (optional)" rows={2} maxLength={1000} value={form.note} onChange={set("note")} />
      <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden value={form.website} onChange={set("website")} />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Sending…" : "Contact me"}</button>
    </form>
  );
}
