import Link from "next/link";

// Server-safe presentational helpers.

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

const CAT_STYLE: Record<string, string> = {
  new: "bg-sky-50 text-sky-700",
  assigned: "bg-indigo-50 text-indigo-700",
  contacted: "bg-violet-50 text-violet-700",
  interested: "bg-amber-50 text-amber-700",
  follow_up: "bg-orange-50 text-orange-700",
  scheduled: "bg-teal-50 text-teal-700",
  won: "bg-brand-100 text-brand-700",
  lost: "bg-slate-200 text-slate-700",
  invalid: "bg-red-50 text-red-700",
};
export function StatusBadge({ name, category }: { name: string; category: string }) {
  return <span className={`badge ${CAT_STYLE[category] ?? "bg-slate-100 text-slate-700"}`}>{name}</span>;
}

export const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-slate-100 text-slate-600", normal: "bg-sky-50 text-sky-700", high: "bg-amber-50 text-amber-700", urgent: "bg-red-50 text-red-700",
};

/** Server-side pagination links preserving current query params. */
export function Pager({ total, limit, offset, params, basePath }: { total: number; limit: number; offset: number; params: Record<string, string | undefined>; basePath: string }) {
  if (total <= limit) return <div className="mt-3 text-xs text-slate-500">{total} result{total === 1 ? "" : "s"}</div>;
  const href = (o: number) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    q.set("offset", String(o));
    return `${basePath}?${q}`;
  };
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
      <div className="flex gap-2">
        {offset > 0 ? <Link className="btn-ghost btn-sm" href={href(Math.max(0, offset - limit))}>Previous</Link> : <span className="btn-ghost btn-sm opacity-40">Previous</span>}
        {offset + limit < total ? <Link className="btn-ghost btn-sm" href={href(offset + limit)}>Next</Link> : <span className="btn-ghost btn-sm opacity-40">Next</span>}
      </div>
    </div>
  );
}
