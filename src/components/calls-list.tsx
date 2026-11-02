"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { callRecordingUrl, saveCallOutcome } from "@/lib/actions/calls";
import { CALL_OUTCOMES, directionOf, fmtDuration, outcomeLabel, type CallRow } from "@/lib/calls";
import { fmtDateTime } from "@/lib/dates";

// List of calls (lead page panel and the /calls log), with recording player and outcome edit.
export function CallsList({ calls, showLead = false, meId, admin }: { calls: CallRow[]; showLead?: boolean; meId: string; admin: boolean }) {
  if (!calls.length) return <p className="text-xs text-slate-500">No calls yet. Calls made from the Lead Box mobile app show up here on their own.</p>;
  return <ul className="divide-y divide-slate-100">{calls.map((c) => <CallItem key={c.id} c={c} showLead={showLead} canEdit={admin || c.user_id === meId} />)}</ul>;
}

function CallItem({ c, showLead, canEdit }: { c: CallRow; showLead: boolean; canEdit: boolean }) {
  const [audio, setAudio] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [edit, setEdit] = useState(false);
  const d = directionOf(c.direction);
  const play = async () => {
    const r = await callRecordingUrl(c.id);
    if (r.url) setAudio(r.url); else setErr(r.error);
  };
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${d.cls}`}>{d.label}</span>
        <span className="font-medium text-navy-900">{fmtDuration(c.duration_sec)}</span>
        {c.outcome && <span className="badge bg-violet-50 text-violet-700">{outcomeLabel(c.outcome)}</span>}
        {showLead && c.lead_id && <Link href={`/leads/${c.lead_id}`} className="text-brand-700 hover:underline">{c.customer_name || c.phone_e164}{c.lead_no ? ` · LB-${c.lead_no}` : ""}</Link>}
        {showLead && !c.lead_id && <span className="text-slate-600">{c.customer_name || c.phone_e164}</span>}
        <span className="ml-auto flex items-center gap-2">
          {c.has_recording && !audio && <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={play}>▶ Recording</button>}
          {canEdit && <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Outcome"}</button>}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-slate-500">{c.user_name} · {fmtDateTime(c.started_at)}{c.source === "app_lite" ? " · approx. duration" : ""}</div>
      {c.note && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{c.note}</div>}
      {audio && <audio className="mt-1 h-9 w-full" src={audio} controls autoPlay preload="none" />}
      {err && <div className="text-xs text-red-600">{err}</div>}
      {edit && <OutcomeForm c={c} onDone={() => setEdit(false)} />}
    </li>
  );
}

function OutcomeForm({ c, onDone }: { c: CallRow; onDone: () => void }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState(c.outcome ?? "");
  const [note, setNote] = useState(c.note);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
      <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
        <option value="">No outcome</option>
        {CALL_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={async () => {
        setBusy(true); const r = await saveCallOutcome(c.id, outcome, note); setBusy(false);
        if (r.error) setErr(r.error); else { onDone(); router.refresh(); }
      }}>{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}
