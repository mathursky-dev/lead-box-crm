"use client";
import { Icon } from "@/components/kit";

/** Download the rows on screen as a CSV (opens in Excel). */
export function CsvButton({ rows, name }: { rows: string[][]; name: string }) {
  const download = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return <button type="button" className="btn-ghost" onClick={download} disabled={rows.length < 2}><Icon name="download" className="h-4 w-4" />Excel / CSV</button>;
}
