"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ActionForm, ActionButton, Field, Submit, Alert } from "@/components/ui";
import { Icon } from "@/components/kit";
import { completeEmbeddedSignup, saveSignupConfig, startQrSession, qrSessionStatus, cancelQrSession, logoutQrNumber } from "@/lib/actions/wa-connect";

type FB = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>) => void;
};
declare global { interface Window { FB?: FB; fbAsyncInit?: () => void } }

export type WaNumber = { id: string; label: string; display_phone: string | null; status: string; provider: string; is_active: boolean };

function WaLogo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path fill="#25D366" d="M16 3C9 3 3.3 8.7 3.3 15.7c0 2.4.7 4.7 1.9 6.7L3 29l6.8-2.1A12.7 12.7 0 1 0 16 3" />
      <path fill="#fff" d="M23.2 19.4c-.4-.2-2.3-1.1-2.6-1.3-.4-.1-.6-.2-.9.2l-1.2 1.5c-.2.3-.4.3-.8.1a10.4 10.4 0 0 1-5.2-4.5c-.4-.7.4-.6 1.1-2 .1-.2 0-.5 0-.7l-1.2-2.8c-.3-.7-.6-.6-.9-.6h-.7c-.3 0-.7.1-1 .5-.4.4-1.4 1.3-1.4 3.2s1.4 3.7 1.6 4c.2.2 2.7 4.2 6.6 5.9 2.5 1.1 3.5 1.2 4.7 1 .8-.1 2.3-.9 2.6-1.9.3-.9.3-1.7.2-1.9-.1-.1-.4-.2-.8-.4" />
    </svg>
  );
}

function FbLogo({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden><path fill="currentColor" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12" /></svg>;
}

/** Integrations card: "Connect" offers the official Facebook signup or a QR scan of a normal WhatsApp number. */
export function WhatsAppCard({ numbers, appId, configId, graphVersion, gatewayReady, disabled }: {
  numbers: WaNumber[]; appId: string | null; configId: string | null; graphVersion: string; gatewayReady: boolean; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const live = numbers.filter((n) => n.status === "connected" && n.is_active);
  return (
    <section className="card mb-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-slate-50"><WaLogo className="h-8 w-8" /></span>
        {live.length ? (
          <span className="badge bg-brand-100 text-brand-700">● Connected · {live.length}</span>
        ) : (
          <span className="badge bg-orange-50 text-orange-700">ⓘ Not Connected</span>
        )}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-navy-900">WhatsApp Business</h2>
      <p className="mt-1 text-sm text-slate-500">Connect with customers on their favourite messaging app. Send updates, support messages and more, all from the Inbox.</p>

      {numbers.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {numbers.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${n.status === "connected" && n.is_active ? "bg-brand-500" : n.status === "error" ? "bg-red-500" : "bg-slate-300"}`} />
              <span className="font-medium text-navy-900">{n.label}</span>
              <span className="text-slate-500">{n.display_phone ?? "—"}</span>
              <span className={`badge ${n.provider === "qr" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700"}`}>{n.provider === "qr" ? "QR scan" : "Official API"}</span>
              {n.provider === "qr" && n.status === "connected" && n.is_active && (
                <span className="ml-auto"><ActionButton action={logoutQrNumber.bind(null, n.id)} confirm="Log this number out of LEAD BOX? You can scan again later.">Log out</ActionButton></span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link href="/admin/numbers" className="btn-ghost justify-center"><Icon name="link" /> Manage</Link>
        <button type="button" className="btn-primary justify-center" onClick={() => setOpen(true)} disabled={disabled}><Icon name="plug" /> Connect</button>
      </div>
      {disabled && <p className="mt-2 text-xs text-red-600">Needs the server service key and encryption key (see Health check).</p>}

      <Modal open={open} onClose={() => setOpen(false)} title="Connect WhatsApp" wide>
        <ConnectOptions appId={appId} configId={configId} graphVersion={graphVersion} gatewayReady={gatewayReady} onDone={() => setOpen(false)} />
      </Modal>
    </section>
  );
}

function ConnectOptions({ appId, configId, graphVersion, gatewayReady, onDone }: { appId: string | null; configId: string | null; graphVersion: string; gatewayReady: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<"pick" | "qr">("pick");
  if (mode === "qr") return <QrConnect onBack={() => setMode("pick")} onDone={onDone} />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col rounded-xl border-2 border-brand-200 p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1877F2] text-white"><FbLogo className="h-5 w-5" /></span>
          <h3 className="font-semibold text-navy-900">Connect with Facebook</h3>
          <span className="badge ml-auto bg-brand-100 text-brand-700">Recommended</span>
        </div>
        <p className="mb-3 text-sm text-slate-600">Official WhatsApp Business API. Log in with Facebook, pick or create your business account and number, verify by OTP. Done in 2 minutes.</p>
        <ul className="mb-4 space-y-1 text-xs text-slate-600">
          <li>✓ Green-tick ready, no ban risk</li>
          <li>✓ Templates, campaigns and chatbots</li>
          <li>ⓘ The number moves from the phone app to the API</li>
        </ul>
        <div className="mt-auto"><FacebookSignup appId={appId} configId={configId} graphVersion={graphVersion} onDone={onDone} /></div>
      </div>

      <div className="flex flex-col rounded-xl border border-slate-200 p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white"><QrIcon /></span>
          <h3 className="font-semibold text-navy-900">Scan QR code</h3>
          <span className="badge ml-auto bg-amber-50 text-amber-800">Unofficial</span>
        </div>
        <p className="mb-3 text-sm text-slate-600">Link any normal WhatsApp or WhatsApp Business app number, like WhatsApp Web. The phone keeps working as usual.</p>
        <ul className="mb-4 space-y-1 text-xs text-slate-600">
          <li>✓ No Meta approval needed</li>
          <li className="text-amber-800">⚠ Not allowed by WhatsApp terms; bulk or cold messaging can get the number banned</li>
          <li className="text-amber-800">⚠ No templates; phone must come online at least every 14 days</li>
        </ul>
        <div className="mt-auto">
          {gatewayReady
            ? <button type="button" className="btn-ghost w-full justify-center" onClick={() => setMode("qr")}><QrIcon /> Scan QR code</button>
            : <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Needs the WhatsApp gateway server. Set <code>WA_GATEWAY_URL</code> and <code>WA_GATEWAY_KEY</code> in Vercel.</p>}
        </div>
      </div>
    </div>
  );
}

function QrIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></svg>;
}

function loadSdk(appId: string, version: string) {
  return new Promise<FB>((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => { window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version }); resolve(window.FB!); };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Could not load Facebook. Disable ad-blockers for this site and try again."));
    document.body.appendChild(s);
  });
}

function FacebookSignup({ appId, configId, graphVersion, onDone }: { appId: string | null; configId: string | null; graphVersion: string; onDone: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; ok?: string }>();
  const [busy, startBusy] = useTransition();
  const [editing, setEditing] = useState(!configId);
  const session = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  useEffect(() => {
    // Embedded Signup posts the chosen WABA / phone ids from the Facebook popup.
    const onMsg = (e: MessageEvent) => {
      try { if (!new URL(e.origin).hostname.endsWith("facebook.com")) return; } catch { return; }
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.type === "WA_EMBEDDED_SIGNUP" && d.data) session.current = { ...session.current, ...d.data };
      } catch { /* other facebook.com messages */ }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  if (!appId) return <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">First save the Meta App ID and App Secret under “Meta app credentials” below.</p>;
  if (editing || !configId) {
    return (
      <ActionForm action={saveSignupConfig} onOk={() => setEditing(false)}>
        <Field label="Embedded Signup configuration ID" hint="Meta App → Facebook Login for Business → Configurations → create one with “WhatsApp Embedded Signup”.">
          <input className="input" name="config_id" defaultValue={configId ?? ""} inputMode="numeric" required />
        </Field>
        <Submit className="btn-primary w-full justify-center">Save</Submit>
      </ActionForm>
    );
  }

  const start = async () => {
    setState(undefined);
    session.current = {};
    let fb: FB;
    try { fb = await loadSdk(appId, graphVersion); } catch (e) { setState({ error: (e as Error).message }); return; }
    fb.login((r) => {
      const code = r.authResponse?.code;
      if (!code) { setState({ error: "Facebook signup was closed before finishing." }); return; }
      startBusy(async () => {
        const res = await completeEmbeddedSignup({ code, wabaId: session.current.waba_id, phoneNumberId: session.current.phone_number_id });
        setState(res);
        if (res?.ok) router.refresh();
      });
    }, { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } });
  };

  return (
    <div className="space-y-2">
      <Alert state={state} />
      {state?.ok ? (
        <button type="button" className="btn-primary w-full justify-center" onClick={onDone}>Done</button>
      ) : (
        <button type="button" className="btn w-full justify-center bg-[#1877F2] text-white hover:bg-[#166FE5]" onClick={start} disabled={busy}>
          <FbLogo /> {busy ? "Connecting…" : "Continue with Facebook"}
        </button>
      )}
      <button type="button" className="block text-xs text-slate-500 hover:underline" onClick={() => setEditing(true)}>Change configuration ID</button>
    </div>
  );
}

function QrConnect({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [s, setS] = useState<Awaited<ReturnType<typeof qrSessionStatus>> | null>(null);
  const [error, setError] = useState<string>();
  const [busy, startBusy] = useTransition();
  const connected = s?.status === "connected";

  useEffect(() => {
    if (!id || connected) return;
    let alive = true;
    const tick = async () => {
      const r = await qrSessionStatus(id).catch(() => null);
      if (!alive || !r) return;
      setS(r);
      if (r.status === "connected") router.refresh();
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [id, connected, router]);

  // Closing the dialog before the phone scans drops the half-made number.
  const pending = useRef<string | null>(null);
  useEffect(() => { pending.current = id && !connected ? id : null; }, [id, connected]);
  useEffect(() => () => { if (pending.current) cancelQrSession(pending.current).catch(() => {}); }, []);
  const leave = useCallback((after: () => void) => {
    if (pending.current) cancelQrSession(pending.current).catch(() => {});
    pending.current = null;
    after();
  }, []);

  if (!id) {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <Field label="Name for this number" hint="Shown in the Inbox, for example “Sales WhatsApp”.">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Sales WhatsApp" />
        </Field>
        {error && <Alert state={{ error }} />}
        <button type="button" className="btn-primary w-full justify-center" disabled={busy}
          onClick={() => startBusy(async () => { const r = await startQrSession(label); if (r.error) setError(r.error); else setId(r.id!); })}>
          {busy ? "Starting…" : "Generate QR code"}
        </button>
        <button type="button" className="btn-ghost w-full justify-center" onClick={onBack}>Back</button>
      </div>
    );
  }

  return (
    <div className="grid items-center gap-5 md:grid-cols-[1fr_auto]">
      <div>
        {connected ? (
          <>
            <h3 className="text-base font-semibold text-brand-700">✓ Connected {s?.name ? `as ${s.name}` : ""}</h3>
            <p className="mt-1 text-sm text-slate-600">{s?.phone ? `+${s.phone}` : ""} is now linked. New chats will show up in the Inbox.</p>
          </>
        ) : (
          <>
            <h3 className="mb-2 font-semibold text-navy-900">Scan with WhatsApp on your phone</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>Open <b>WhatsApp</b> on the phone</li>
              <li>Tap <b>⋮ Menu</b> (Android) or <b>Settings</b> (iPhone)</li>
              <li>Tap <b>Linked devices</b> → <b>Link a device</b></li>
              <li>Point the phone at this QR code</li>
            </ol>
            {s?.status === "expired" && <p className="mt-3 text-sm text-red-600">The QR code expired. Go back and generate a new one.</p>}
            {s?.status === "logged_out" && <p className="mt-3 text-sm text-red-600">WhatsApp refused the link. Go back and try again.</p>}
            {s?.error && <p className="mt-3 text-xs text-slate-500">{s.error}</p>}
          </>
        )}
        <div className="mt-4 flex gap-2">
          {connected
            ? <button type="button" className="btn-primary" onClick={onDone}>Done</button>
            : <button type="button" className="btn-ghost" onClick={() => leave(onBack)}>Back</button>}
        </div>
      </div>
      <div className="mx-auto flex h-64 w-64 items-center justify-center rounded-xl border border-slate-200 bg-white p-2">
        {connected ? <WaLogo className="h-24 w-24" />
          : s?.qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL from the gateway
            <img src={s.qr} alt="WhatsApp login QR code" className="h-full w-full" />
          )
          : <span className="text-sm text-slate-400">{s?.status === "connecting" ? "Linking…" : "Loading QR…"}</span>}
      </div>
    </div>
  );
}
