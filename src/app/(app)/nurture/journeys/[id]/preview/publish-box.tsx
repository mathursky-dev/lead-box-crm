"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { publishJourney } from "@/lib/actions/automation";

export function PublishBox({ id, next, canPublish, hasWarnings }: { id: string; next: number; canPublish: boolean; hasWarnings: boolean }) {
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <section className="card p-4">
      <h2 className="mb-2 text-sm font-semibold text-navy-900">Publish v{next}</h2>
      {!canPublish ? <p className="text-sm text-slate-500">Already live with no changes.</p> : (
        <>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            I reviewed who this reaches and what it sends{hasWarnings ? ", including the warnings" : ""}. Publishing makes it live for new enrolments.</label>
          <button className="btn-primary mt-3" disabled={!ok || pending} onClick={() => start(async () => {
            const r = await publishJourney(id); setMsg(r); if (!r.error) router.push(`/nurture/journeys/${id}`);
          })}>{pending ? "Publishing…" : "Publish & activate"}</button>
        </>
      )}
      {msg?.error && <p role="alert" className="mt-2 text-sm text-red-600">{msg.error}</p>}
      {msg?.ok && <p className="mt-2 text-sm text-brand-700">{msg.ok}</p>}
    </section>
  );
}
