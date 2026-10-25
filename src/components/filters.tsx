import Link from "next/link";
import { Icon } from "./kit";
import { PRESETS } from "@/lib/dates";
import type { FilterParams } from "@/lib/metrics";
import type { Refs } from "@/lib/data";

// Shared dashboard/report filter bar (GET form; IST date presets + org filters).
// Compact controls that size to their content, so most filters fit on one line on desktop.
const F = "input h-8 py-1! pl-2.5! pr-6! text-xs! sm:w-auto sm:max-w-44";
export function Filters({ sp, refs, manager, visible, basePath, hidden = {} }: { sp: FilterParams; refs: Refs; manager: boolean; visible: Set<string>; basePath: string; hidden?: Record<string, string> }) {
  const sel = (name: keyof FilterParams, label: string, opts: { id: string; name: string }[]) => (
    <select className={F} name={name} defaultValue={sp[name] ?? ""} aria-label={label}><option value="">All {label}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
  );
  return (
    <form action={basePath} className="card mb-4 grid grid-cols-2 gap-1.5 p-2 sm:flex sm:flex-wrap sm:items-center">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select className={F} name="preset" defaultValue={sp.preset ?? "today"} aria-label="Period">{PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
      <input className={`${F} sm:w-32`} type="date" name="from" defaultValue={sp.from} aria-label="From (custom)" title="Custom range start" />
      <input className={`${F} sm:w-32`} type="date" name="to" defaultValue={sp.to} aria-label="To (custom)" title="Custom range end (inclusive)" />
      {manager && sel("branch_id", "branches", refs.branches)}
      {manager && sel("department_id", "departments", refs.departments)}
      {manager && sel("team_id", "teams", refs.teams)}
      {manager && sel("user_id", "users", refs.users.filter((u) => visible.has(u.id)).map((u) => ({ id: u.id, name: u.full_name })))}
      {sel("number_id", "numbers", refs.numbers.map((n) => ({ id: n.id, name: n.label })))}
      {sel("product_id", "products", refs.products)}
      {sel("source_id", "sources", refs.sources)}
      {sel("status_id", "statuses", refs.statuses)}
      <div className="col-span-2 flex gap-1.5 sm:ml-auto"><button className="btn-primary btn-sm h-8 flex-1 px-3"><Icon name="filter" className="h-3.5 w-3.5" />Apply</button><Link className="btn-ghost btn-sm h-8 px-3" href={`${basePath}${hidden.tab ? `?tab=${hidden.tab}` : ""}`}>Reset</Link></div>
    </form>
  );
}

