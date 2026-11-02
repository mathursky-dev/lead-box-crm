"use client";
import { useState, useTransition } from "react";
import { sendOwnerSummaryNow } from "@/lib/actions/owner-summary";

export function SendNow() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok?: string; error?: string }>();
  return (
    <div className="space-y-2">
      <button type="button" className="btn-primary btn-sm" disabled={pending} onClick={() => start(async () => setRes(await sendOwnerSummaryNow()))}>
        {pending ? "Sending…" : "Send it to me now"}
      </button>
      {res?.ok && <p className="text-sm text-emerald-700">{res.ok}</p>}
      {res?.error && <p role="alert" className="text-sm text-red-600">{res.error}</p>}
    </div>
  );
}
