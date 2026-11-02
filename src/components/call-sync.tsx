"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { syncDeviceCalls, startRecordingUpload, attachRecording, saveCallOutcome, type SyncResult } from "@/lib/actions/calls";
import { CALL_OUTCOMES, fmtDuration, type DeviceCall } from "@/lib/calls";

// Bridge to the Lead Box Android app (native plugin "LeadBoxCalls", see mobile/README.md).
// In a normal browser the plugin is missing and this renders nothing.

type NativeCall = DeviceCall & { recording?: { uri: string; name: string; size: number } | null };
type Plugin = {
  getInfo(): Promise<{ flavor: "full" | "lite"; version: string; permission: "granted" | "denied" | "prompt" }>;
  requestPermissions(): Promise<{ permission: "granted" | "denied" | "prompt" }>;
  getCalls(o: { since: number }): Promise<{ calls: NativeCall[] }>;
  dial(o: { number: string }): Promise<void>;
  uploadFile(o: { uri: string; url: string }): Promise<{ ok: boolean; status?: number }>;
};

function plugin(): Plugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  return cap?.isNativePlatform?.() ? ((cap.Plugins?.LeadBoxCalls as Plugin) ?? null) : null;
}

/** Calls a number. Inside the app the call is tracked; elsewhere it opens the phone's dialer. */
export function dialNumber(phone: string) {
  const p = plugin();
  const num = "+" + phone.replace(/\D/g, "");
  if (p) p.dial({ number: num }).catch(() => { window.location.href = `tel:${num}`; });
  else window.location.href = `tel:${num}`;
}
export const inApp = () => plugin() !== null;

const HOUR = 3600000;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function CallSync({ userId }: { userId: string }) {
  const [perm, setPerm] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<SyncResult["prompt"]>(null);
  const busy = useRef(false);
  const sinceKey = `lb.calls.since.${userId}`, upKey = `lb.calls.uploaded.${userId}`;

  const sync = useCallback(async () => {
    const p = plugin();
    if (!p || busy.current) return;
    busy.current = true;
    try {
      const info = await p.getInfo();
      setPerm(info.permission);
      if (info.permission !== "granted") return;
      // Re-read the last 6 hours each time so recordings that are written a little after the
      // call still get picked up; the server ignores calls it already has.
      const last = Number(store.get(sinceKey)) || Date.now() - 48 * HOUR;
      const { calls } = await p.getCalls({ since: Math.max(last - 6 * HOUR, Date.now() - 30 * 24 * HOUR) });
      if (!calls?.length) return;
      const source = info.flavor === "lite" ? "app_lite" : "app";
      let newest = last, recordingsOn = true, latestPrompt: SyncResult["prompt"] = null;
      const ids = new Map<string, string>();
      for (let i = 0; i < calls.length; i += 200) {
        const batch = calls.slice(i, i + 200);
        const r = await syncDeviceCalls(batch.map(({ key, number, direction, startedAt, duration }) => ({ key, number, direction, startedAt, duration, source })));
        if (r.error) return;
        if (r.recordings === false) recordingsOn = false;
        if (r.prompt) latestPrompt = r.prompt;
        for (const s of r.saved ?? []) if (s.id) ids.set(s.key, s.id);
      }
      for (const c of calls) newest = Math.max(newest, c.startedAt);
      store.set(sinceKey, String(newest));
      if (latestPrompt) setPrompt(latestPrompt);

      if (!recordingsOn) return;
      const done = new Set<string>(JSON.parse(store.get(upKey) || "[]"));
      for (const c of calls) {
        const id = ids.get(c.key);
        if (!id || !c.recording || done.has(id)) continue;
        const up = await startRecordingUpload(id, c.recording.name, c.recording.size);
        if (up.url) {
          const res = await p.uploadFile({ uri: c.recording.uri, url: up.url });
          if (res.ok && !(await attachRecording(id)).error) done.add(id);
        } else if (/already/i.test(up.error ?? "")) done.add(id);
      }
      store.set(upKey, JSON.stringify([...done].slice(-300)));
    } catch { /* try again on the next resume */ } finally { busy.current = false; }
  }, [sinceKey, upKey]);

  useEffect(() => {
    if (!plugin()) return;
    sync();
    const onVis = () => document.visibilityState === "visible" && setTimeout(sync, 1500);
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(sync, 5 * 60000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [sync]);

  const allow = async () => {
    const p = plugin();
    if (!p) return;
    const r = await p.requestPermissions();
    setPerm(r.permission);
    if (r.permission === "granted") sync();
  };

  return (
    <>
      {perm && perm !== "granted" && (
        <div className="fixed inset-x-3 bottom-3 z-40 flex items-center gap-3 rounded-xl border border-violet-200 bg-white p-3 text-sm shadow-lg sm:left-auto sm:right-4 sm:w-96">
          <span className="flex-1 text-navy-900">Allow call access so calls with your leads are saved automatically.</span>
          <button type="button" className="btn-primary btn-sm" onClick={allow}>Allow</button>
        </div>
      )}
      {prompt && <OutcomePopup p={prompt} onClose={() => setPrompt(null)} />}
    </>
  );
}

function OutcomePopup({ p, onClose }: { p: NonNullable<SyncResult["prompt"]>; onClose: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string>();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await saveCallOutcome(p.id, outcome, note);
    setSaving(false);
    if (r.error) setErr(r.error); else onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-label="Call outcome">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="text-xs text-slate-500">Call saved · {fmtDuration(p.duration)}</div>
        <div className="mt-0.5 font-semibold text-navy-900">How did the call with <Link href={`/leads/${p.lead_id}`} className="text-brand-700 hover:underline" onClick={onClose}>{p.name || `LB-${p.lead_no}`}</Link> go?</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CALL_OUTCOMES.map((o) => (
            <button key={o.value} type="button" onClick={() => setOutcome(o.value)}
              className={`rounded-full border px-3 py-1 text-xs ${outcome === o.value ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{o.label}</button>
          ))}
        </div>
        <textarea className="input mt-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Skip</button>
          <button type="button" className="btn-primary btn-sm" disabled={saving || (!outcome && !note.trim())} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
