import Link from "next/link";
import { Icon, TILE } from "./kit";

// Server-safe presentational helpers.

export function PageHeader({ title, sub, actions, icon, tone = "green" }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; icon?: string; tone?: keyof typeof TILE }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl shadow-sm ${TILE[tone] ?? TILE.green}`}><Icon name={icon} className="h-5 w-5" /></span>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
          {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, icon = "inbox" }: { title: string; children?: React.ReactNode; icon?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name={icon} className="h-6 w-6" /></span>
      <div className="text-sm font-semibold text-navy-900">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>;
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
