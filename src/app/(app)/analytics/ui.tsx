import Link from "next/link";
import { Icon } from "@/components/kit";

// Server-side layout pieces for /analytics.

/** Card with a left accent bar on the title, optional toolbar and a one-line headline under it. */
export function Box({ title, actions, headline, children, className = "" }: { title: string; actions?: React.ReactNode; headline?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy-900"><span className="h-4 w-1 rounded-full bg-brand-600" />{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {headline && <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-600">{headline}</div>}
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

/** Small segmented toggle made of links (chart view switches). */
export function Toggle({ options, value, href }: { options: { value: string; label: string; icon?: string }[]; value: string; href: (v: string) => string }) {
  return (
    <span className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      {options.map((o) => (
        <Link key={o.value} href={href(o.value)} scroll={false} aria-current={o.value === value ? "true" : undefined}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition ${o.value === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
          {o.icon && <Icon name={o.icon} className="h-3 w-3" />}{o.label}
        </Link>
      ))}
    </span>
  );
}

export function NoData({ children = "No data for this period" }: { children?: React.ReactNode }) {
  return <div className="grid h-full min-h-[180px] place-items-center text-center text-sm text-slate-400">{children}</div>;
}

/** Stat tile in the Summary row: title, big number, then Potential / Actual (or any two) underneath. */
export function SumCard({ title, icon, value, href, foot }: { title: string; icon: string; value: React.ReactNode; href?: string; foot?: { label: string; value: React.ReactNode }[] }) {
  const num = <div className="px-3 py-3 text-2xl font-bold text-navy-900">{value}</div>;
  return (
    <div className="flex min-w-[180px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-navy-800">
        <Icon name={icon} className="h-3.5 w-3.5 text-brand-600" /><span className="truncate" title={title}>{title}</span>
      </div>
      {href ? <Link href={href} className="hover:bg-brand-50/40">{num}</Link> : num}
      {foot && (
        <div className="mt-auto grid border-t border-slate-100 text-xs" style={{ gridTemplateColumns: `repeat(${foot.length}, minmax(0,1fr))` }}>
          {foot.map((f, i) => (
            <div key={f.label} className={`px-3 py-2 ${i ? "border-l border-slate-100" : ""}`}><div className="text-slate-500">{f.label}</div><div className="font-semibold text-navy-900">{f.value}</div></div>
          ))}
        </div>
      )}
    </div>
  );
}
