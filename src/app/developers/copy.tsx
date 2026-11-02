"use client";
import { useState } from "react";

export function CopyCode({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="rounded px-2 py-0.5 text-[11px] normal-case text-slate-300 hover:bg-white/10"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}
