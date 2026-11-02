"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { signQuote } from "@/lib/actions/public-quote";

/** Name + drawn signature + consent. Works with mouse, touch and pen. */
export function SignForm({ token, defaultName, total, business }: { token: string; defaultName: string; total: string; business: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f2a44";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!, p = point(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!, p = point(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
    setInked(true);
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setInked(false);
  };

  if (done) return <div role="status" className="rounded-lg bg-emerald-50 px-4 py-4 text-center text-sm text-emerald-800">✅ Thank you, {name}! Quotation {done} is accepted and signed. {business} has been notified.</div>;

  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      setErr("");
      if (!inked) { setErr("Please draw your signature in the box."); return; }
      const website = (e.currentTarget.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "";
      start(async () => {
        const r = await signQuote(token, { name, signature: canvas.current!.toDataURL("image/png"), agree, website });
        if (r.error) setErr(r.error); else setDone(r.docNo ?? "");
      });
    }}>
      <h2 className="text-base font-semibold text-slate-900">Accept &amp; sign</h2>
      <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Your full name</span>
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoComplete="name" /></label>
      <div>
        <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-slate-700">Signature</span>
          <button type="button" className="text-xs text-slate-500 underline" onClick={clear}>Clear</button></div>
        <canvas ref={canvas} aria-label="Draw your signature here" className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white"
          onPointerDown={down} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerLeave={() => { drawing.current = false; }} />
        <p className="mt-1 text-xs text-slate-500">Draw with your finger or mouse.</p>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I accept this quotation of <b>{total}</b> and its terms, and agree that this electronic signature is my signature.</span></label>
      {err && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <button className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-60" disabled={pending}>{pending ? "Saving…" : "Accept & sign"}</button>
    </form>
  );
}
