"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui";
import { assignLeads } from "@/lib/actions/leads";
import { retryMessage } from "@/lib/actions/inbox";
import { enrollmentAction } from "@/lib/actions/nurture";
import { failedJobAction, complaintAction, automationPause } from "@/lib/actions/automation";

export function QueueActions({ kind, id, users = [], unknown, conv }: { kind: string; id: string; users?: { id: string; full_name: string }[]; unknown?: boolean; conv?: string }) {
  const [to, setTo] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  if (kind === "lead") return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {users.length > 0 && (
        <>
          <select className="input w-40 py-1 text-xs" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Assign to">
            <option value="">Assign to…</option><option value="__auto__">Round-robin</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <button className="btn-ghost btn-sm" disabled={!to || pending} onClick={() => start(async () => {
            const fd = new FormData(); fd.set("lead_ids", id); fd.set("owner_id", to);
            const r = await assignLeads(undefined, fd); if (r?.error) setErr(r.error); else router.refresh();
          })}>Assign</button>
        </>
      )}
      <Link className="btn-primary btn-sm" href={`/leads/${id}#next-action`}>Set next action</Link>
      {err && <span className="w-full text-right text-xs text-red-600">{err}</span>}
    </span>
  );
  if (kind === "message") return (
    <ActionButton className="btn-ghost btn-sm" action={async () => { const r = await retryMessage(id); return r.error ? { error: r.error } : { ok: "Queued" }; }}
      confirm={unknown ? "This send may already have been delivered. Retry anyway?" : "Retry this message?"}>Retry</ActionButton>
  );
  if (kind === "failed_enrollment" || kind === "failed_job") {
    const k = kind === "failed_job" ? "job" : "enrollment";
    return (
      <span className="inline-flex gap-1">
        <ActionButton action={() => failedJobAction(k, id, "retry")} confirm="Retry now? Eligibility is rechecked before any send.">Retry</ActionButton>
        <ActionButton action={() => failedJobAction(k, id, "dismiss")} confirm="Dismiss this failure? It will not be retried.">Dismiss</ActionButton>
      </span>
    );
  }
  if (kind === "complaint") return (
    <ActionButton action={() => { const note = window.prompt("Resolution note (optional)"); return note === null ? Promise.resolve(undefined) : complaintAction(conv ?? "", "resolve", note, id); }}>Resolve</ActionButton>
  );
  return (
    <span className="inline-flex gap-1">
      <ActionButton action={() => enrollmentAction(id, "resume")} confirm="Resume this journey for the customer?">Resume</ActionButton>
      <ActionButton action={() => enrollmentAction(id, "stop")} confirm="Stop this journey for the customer?">Stop</ActionButton>
    </span>
  );
}

export function AutomationSwitch({ paused, reason }: { paused: boolean; reason: string | null }) {
  return paused ? (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
      <b>All automation is paused.</b>{reason && <span>Reason: {reason}</span>}<span className="text-xs">Journeys, campaigns and automated sends wait; nothing is lost.</span>
      <span className="ml-auto"><ActionButton className="btn-primary btn-sm" action={() => automationPause(false, "")} confirm="Resume all automation for the company?">Resume automation</ActionButton></span>
    </div>
  ) : (
    <ActionButton className="btn-ghost btn-sm text-red-700" action={() => { const r = window.prompt("Pause ALL automation for the company? Enter a reason:"); return r === null ? Promise.resolve(undefined) : automationPause(true, r); }}>Pause all automation</ActionButton>
  );
}
