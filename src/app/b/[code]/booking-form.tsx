"use client";
import { useState, useTransition } from "react";
import { bookSlot } from "@/lib/actions/public-care";

export type Day = { date: string; slots: { at: string; label: string }[] };

const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${ymd}T00:00:00Z`));

export function BookingForm({ code, open, days, thankYou, location }: { code: string; open: boolean; days: Day[]; thankYou: string; location: string }) {
  const [day, setDay] = useState(days[0]?.date ?? "");
  const [at, setAt] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", note: "", website: "" });
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const slots = days.find((d) => d.date === day)?.slots ?? [];
  const chosen = slots.find((s) => s.at === at);

  if (done !== null) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</div>
        <h2 className="text-lg font-bold text-slate-900">Booked{done ? ` for ${done}` : ""}</h2>
        {location && <p className="mt-1 text-sm text-slate-600">📍 {location}</p>}
        {meeting && <p className="mt-2 text-sm"><a href={meeting} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 underline">🎥 Video meeting link</a><span className="block text-xs text-slate-500">Save this link to join at your time.</span></p>}
        <p className="mt-3 text-sm text-slate-600">{thankYou}</p>
      </div>
    );
  }
  if (!open || !days.length) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
        {open ? "No free slots in the coming days. Please message us on WhatsApp to fix a time." : "Online booking is closed right now. Please message us on WhatsApp."}
      </div>
    );
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!at) { setError("Pick a time slot."); return; }
    start(async () => {
      const r = await bookSlot(code, { ...form, at });
      if (r.error) { setError(r.error); if (/taken/.test(r.error)) setAt(""); return; }
      setMeeting(r.meeting ?? null);
      setDone(r.label ?? "");
    });
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-900">1. Pick a day</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => (
            <button key={d.date} type="button" onClick={() => { setDay(d.date); setAt(""); }}
              className={`shrink-0 rounded-xl border px-3 py-2 text-center text-sm ${d.date === day ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
              <span className="block font-semibold">{dayLabel(d.date)}</span>
              <span className="block text-[11px] opacity-80">{d.slots.length} free</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-900">2. Pick a time</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slots.map((s) => (
            <button key={s.at} type="button" onClick={() => setAt(s.at)}
              className={`rounded-lg border px-2 py-2 text-sm font-medium ${s.at === at ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700"}`}>{s.label}</button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-900">3. Your details</p>
        <input className="input" placeholder="Your name" required maxLength={120} value={form.name} onChange={set("name")} />
        <input className="input" placeholder="WhatsApp number" required inputMode="tel" maxLength={20} value={form.phone} onChange={set("phone")} />
        <textarea className="input" placeholder="Anything we should know? (optional)" rows={2} maxLength={1000} value={form.note} onChange={set("note")} />
        <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden value={form.website} onChange={set("website")} />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Booking…" : chosen ? `Book ${dayLabel(day)}, ${chosen.label}` : "Book appointment"}
      </button>
    </form>
  );
}
