import Link from "next/link";
import { PRESETS } from "@/lib/dates";
import type { FilterParams } from "@/lib/metrics";
import type { Refs } from "@/lib/data";

// Shared dashboard/report filter bar (GET form; IST date presets + org filters).
export function Filters({ sp, refs, manager, visible, basePath, hidden = {} }: { sp: FilterParams; refs: Refs; manager: boolean; visible: Set<string>; basePath: string; hidden?: Record<string, string> }) {
  const sel = (name: keyof FilterParams, label: string, opts: { id: string; name: string }[]) => (
    <select className="input" name={name} defaultValue={sp[name] ?? ""} aria-label={label}><option value="">All {label}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
  );
  return (
    <form action={basePath} className="card mb-4 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select className="input" name="preset" defaultValue={sp.preset ?? "today"} aria-label="Period">{PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
      <input className="input" type="date" name="from" defaultValue={sp.from} aria-label="From (custom)" title="Custom range start" />
      <input className="input" type="date" name="to" defaultValue={sp.to} aria-label="To (custom)" title="Custom range end (inclusive)" />
      {manager && sel("branch_id", "branches", refs.branches)}
      {manager && sel("department_id", "departments", refs.departments)}
      {manager && sel("team_id", "teams", refs.teams)}
      {manager && sel("user_id", "users", refs.users.filter((u) => visible.has(u.id)).map((u) => ({ id: u.id, name: u.full_name })))}
      {sel("number_id", "numbers", refs.numbers.map((n) => ({ id: n.id, name: n.label })))}
      {sel("product_id", "products", refs.products)}
      {sel("source_id", "sources", refs.sources)}
      {sel("status_id", "statuses", refs.statuses)}
      <div className="flex gap-2"><button className="btn-navy flex-1">Apply</button><Link className="btn-ghost" href={`${basePath}${hidden.tab ? `?tab=${hidden.tab}` : ""}`}>Reset</Link></div>
    </form>
  );
}

