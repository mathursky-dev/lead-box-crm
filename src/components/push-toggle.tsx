"use client";
import { useEffect, useState, useTransition } from "react";
import { pushPublicKey, removePushSubscription, savePushSubscription, sendTestAlert } from "@/lib/actions/alerts";
import { Icon } from "./kit";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

const toKey = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** "Turn on phone notifications" button: registers /sw.js and saves the push subscription. */
export function PushToggle({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>();
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const turnOn = () => start(async () => {
    setMsg(undefined);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const key = await pushPublicKey();
      if (!key) { setMsg({ error: "Push is not available on the server yet." }); return; }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) }));
      const r = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if (r.error) { setMsg(r); return; }
      setState("on");
      setMsg({ ok: "Notifications are on for this device." });
    } catch (e) {
      setMsg({ error: (e as Error).message || "Could not turn on notifications." });
    }
  });

  const turnOff = () => start(async () => {
    setMsg(undefined);
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe().catch(() => {}); }
    setState("off");
  });

  const test = () => start(async () => { setMsg(await sendTestAlert()); });

  if (state === "loading") return null;
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "rounded-xl border border-slate-200 bg-white p-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="alert" className="h-4 w-4 text-brand-700" />
        {state === "on" ? (
          <>
            <span className="text-sm font-medium text-emerald-700">Phone notifications on</span>
            <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={test}>Send test</button>
            <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={turnOff}>Turn off</button>
          </>
        ) : state === "off" ? (
          <>
            {!compact && <span className="text-sm text-slate-600">Get missed follow-up alerts on this phone / browser.</span>}
            <button type="button" className="btn-primary btn-sm" disabled={pending} onClick={turnOn}>{pending ? "Turning on…" : "Turn on notifications"}</button>
          </>
        ) : state === "denied" ? (
          <span className="text-sm text-amber-700">Notifications are blocked for this site. Allow them in the browser / app settings, then reload.</span>
        ) : (
          <span className="text-sm text-slate-500">This browser can&apos;t show push notifications. On iPhone, add Lead Box to the Home Screen first.</span>
        )}
      </div>
      {msg?.error && <p className="mt-1 text-xs text-red-600">{msg.error}</p>}
      {msg?.ok && <p className="mt-1 text-xs text-emerald-700">{msg.ok}</p>}
    </div>
  );
}
