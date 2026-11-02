"use client";
import { useState, useTransition } from "react";
import { submitFeedback } from "@/lib/actions/public-care";

const tone = (n: number) => (n >= 9 ? "bg-emerald-600 text-white border-emerald-600" : n >= 7 ? "bg-amber-400 text-white border-amber-400" : "bg-red-500 text-white border-red-500");

export function FeedbackForm({ token, question, initial }: { token: string; question: string; initial: number | null }) {
  const [score, setScore] = useState<number | null>(initial);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ review: string | null } | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-3xl">🙏</div>
        <h2 className="text-lg font-bold text-slate-900">Thank you for your feedback!</h2>
        {done.review ? (
          <>
            <p className="mt-2 text-sm text-slate-600">So glad you liked it! Would you share it in a quick review? It helps us a lot.</p>
            <a href={done.review} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white">Write a review ⭐</a>
          </>
        ) : <p className="mt-2 text-sm text-slate-600">We read every response and will use it to serve you better.</p>}
      </div>
    );
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (score == null) { setError("Pick a score from 0 to 10."); return; }
    setError(undefined);
    start(async () => {
      const r = await submitFeedback(token, score, comment);
      if (r.error) setError(r.error); else setDone({ review: r.reviewUrl ?? null });
    });
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm font-medium text-slate-800">{question}</p>
      <div>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" onClick={() => setScore(n)} aria-pressed={score === n}
              className={`h-10 rounded-lg border text-sm font-semibold ${score === n ? tone(n) : "border-slate-200 text-slate-700"}`}>{n}</button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>Not likely</span><span>Very likely</span></div>
      </div>
      <textarea className="input" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)}
        placeholder={score != null && score <= 6 ? "Sorry to hear that. What went wrong?" : "Anything you'd like to tell us? (optional)"} />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Sending…" : "Submit"}</button>
    </form>
  );
}
