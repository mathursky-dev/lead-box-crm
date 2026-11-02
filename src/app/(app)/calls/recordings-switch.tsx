"use client";
import { useState, useTransition } from "react";
import { setCallRecordings } from "@/lib/actions/calls";

export function RecordingsSwitch({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700" title="Lets the mobile app upload call recordings to the CRM">
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => {
        const v = e.target.checked; setOn(v);
        start(async () => { const r = await setCallRecordings(v); if (r.error) { setOn(!v); setErr(r.error); } });
      }} />
      Upload call recordings{err && <span className="text-xs text-red-600"> {err}</span>}
    </label>
  );
}
