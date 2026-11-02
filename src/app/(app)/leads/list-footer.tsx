"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PAGE_SIZES } from "./page-sizes";

// Bottom bar of the leads list: total count, "Show [N] rows per page" and Previous/Next.
// Changing the page size goes back to the first page and keeps every other filter.
export function ListFooter({ total, per, offset, qs }: { total: number; per: number; offset: number; qs: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const href = (o: number, p = per) => {
    const q = new URLSearchParams(qs);
    q.delete("offset"); q.delete("per");
    if (o > 0) q.set("offset", String(o));
    if (p !== 50) q.set("per", String(p));
    const s = q.toString();
    return s ? `/leads?${s}` : "/leads";
  };
  const page = Math.floor(offset / per) + 1;
  const pages = Math.max(1, Math.ceil(total / per));
  const btn = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-900 hover:border-slate-300";
  const off = "rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-sm text-slate-400";

  return (
    <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="font-semibold text-navy-900">{total.toLocaleString("en-IN")} Lead{total === 1 ? "" : "s"}</span>
        <label className="inline-flex items-center gap-2">
          Show
          <select aria-label="Rows per page" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-navy-900 focus:border-brand-500 focus:outline-none"
            value={per} onChange={(e) => start(() => router.push(href(0, Number(e.target.value))))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          rows per page
        </label>
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{offset + 1}–{Math.min(offset + per, total)} of {total} · Page {page} of {pages}</span>
          {offset > 0 ? <Link className={btn} href={href(Math.max(0, offset - per))}>Previous</Link> : <span className={off}>Previous</span>}
          {offset + per < total ? <Link className={btn} href={href(offset + per)}>Next</Link> : <span className={off}>Next</span>}
        </div>
      )}
    </div>
  );
}
