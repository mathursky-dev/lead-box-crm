"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makeMeetingLink } from "@/lib/actions/meetings";

/** Appointment row: join link, or a button to create / retry it. */
export function MeetingCell({ id, url, error, canCreate }: { id: string; url: string | null; error: string | null; canCreate: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(error);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  if (url) {
    return (
      <span className="flex items-center gap-2 whitespace-nowrap text-sm">
        <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">🎥 Join</a>
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={async () => { await navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
    );
  }
  if (!canCreate) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <button type="button" className="btn-ghost btn-sm whitespace-nowrap" disabled={pending}
        onClick={() => start(async () => { const r = await makeMeetingLink(id); setErr(r.error ?? null); if (!r.error) router.refresh(); })}>
        {pending ? "Creating…" : err ? "Retry link" : "Create link"}
      </button>
      {err && <span className="max-w-[14rem] text-xs text-red-600" title={err}>{err.length > 80 ? `${err.slice(0, 80)}…` : err}</span>}
    </span>
  );
}
