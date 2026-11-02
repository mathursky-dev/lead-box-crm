"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ivrCallLead } from "@/lib/actions/ivr";

/** "IVR call": the provider rings the agent's mobile, then connects the customer from the company number. */
export function IvrCallButton({ leadId, className = "btn-ghost btn-sm" }: { leadId: string; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className={className} disabled={pending} title="Cloud call: your phone rings first, the customer sees the company number, the call is recorded"
        onClick={() => start(async () => { const r = await ivrCallLead(leadId); setMsg(r ?? {}); if (r?.ok) setTimeout(() => router.refresh(), 4000); })}>
        {pending ? "Calling…" : "☎️ IVR call"}
      </button>
      {msg?.error && <span className="max-w-xs text-xs text-red-600">{msg.error}</span>}
      {msg?.ok && <span className="max-w-xs text-xs text-brand-700">{msg.ok}</span>}
    </span>
  );
}
