"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { verifyTwoFactor, startTwoFactorSetup, confirmTwoFactorSetup } from "@/lib/actions/security";
import { Submit } from "@/components/ui";

const codeInput = "input text-center text-2xl tracking-[0.4em] font-semibold";

export function TwoFactorVerify({ next }: { next: string }) {
  const [state, run] = useActionState(verifyTwoFactor, undefined);
  useEffect(() => { if (state?.next) window.location.assign(state.next); }, [state]);
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input name="code" className={codeInput} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="000000" autoFocus required aria-label="6-digit code" />
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <Submit className="btn-primary w-full" pendingText="Checking…">Verify</Submit>
    </form>
  );
}

/** QR code + confirm code. Used on the sign-in gate and on the Security page. */
export function TwoFactorSetup({ next, onDone }: { next?: string; onDone?: () => void }) {
  const [setup, setSetup] = useState<{ factorId?: string; qr?: string; secret?: string; error?: string }>();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  useEffect(() => { startTwoFactorSetup().then(setSetup); }, []);
  if (!setup) return <p className="text-sm text-slate-500">Making your QR code…</p>;
  if (setup.error) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{setup.error}</p>;
  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code for your authenticator app" className="mx-auto h-44 w-44 rounded-lg border border-slate-200 bg-white p-1" />
      <p className="text-center text-xs text-slate-500">Can&apos;t scan? Enter this key in the app:<br /><code className="select-all break-all font-mono text-[13px] text-navy-900">{setup.secret}</code></p>
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className={codeInput} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="6-digit code from the app" />
      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <button type="button" className="btn-primary w-full" disabled={pending || code.length !== 6}
        onClick={() => start(async () => {
          const r = await confirmTwoFactorSetup(setup.factorId!, code, next);
          if (r.error) { setErr(r.error); return; }
          if (onDone) onDone(); else window.location.assign(r.next ?? "/dashboard");
        })}>
        {pending ? "Checking…" : "Turn on two-factor"}
      </button>
    </div>
  );
}
