"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAiForecast } from "@/lib/actions/forecast";

export function RunForecastButton({ target, label }: { target: "this" | "next"; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" className="btn btn-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60" disabled={pending}
        onClick={() => start(async () => {
          setErr(undefined);
          const r = await runAiForecast(target);
          if (r.error) setErr(r.error); else router.refresh();
        })}>
        {pending ? "✨ AI is forecasting… (up to a minute)" : `✨ ${label}`}
      </button>
      {err && <span role="alert" className="max-w-xs text-right text-xs text-red-600">{err}</span>}
    </span>
  );
}
