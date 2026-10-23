"use client";
import { useState, useTransition } from "react";
import type { TestResult } from "@/lib/actions/facebook";

export function TestButton({ action }: { action: () => Promise<TestResult> }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<TestResult>();
  return (
    <>
      <button type="button" className="btn btn-sm rounded-full bg-indigo-700 px-4 text-white hover:bg-indigo-800" disabled={pending}
        onClick={() => start(async () => setRes(await action()))}>
        {pending ? "Testing…" : "Test"}
      </button>
      {res && (
        <div role="status" className="absolute inset-x-3 top-12 z-10 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
          <button type="button" className="absolute right-2 top-1 text-slate-400 hover:text-slate-700" onClick={() => setRes(undefined)} aria-label="Close">✕</button>
          {res.error ? <p className="text-red-700">{res.error}</p> : (
            <ul className="space-y-1">
              {res.checks?.map(([label, pass, detail]) => (
                <li key={label} className="flex items-start gap-2">
                  <span className={pass ? "text-brand-600" : "text-red-600"} aria-label={pass ? "pass" : "fail"}>{pass ? "✓" : "✗"}</span>
                  <span><span className="font-medium text-navy-900">{label}</span><span className="block text-xs text-slate-500">{detail}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
