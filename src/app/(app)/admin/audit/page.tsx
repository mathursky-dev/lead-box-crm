import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, Pager, Empty, ErrorBox } from "@/components/static";
import { Icon } from "@/components/kit";
import { Tx } from "@/components/lang";
import { fmtDateTime } from "@/lib/dates";
import { auditQuery, AUDIT_TYPES, type AuditFilters } from "@/lib/audit-query";
import { actionLabel, changesOf, nameMaps, subjectOf, type AuditRow } from "@/lib/audit-format";

export const metadata = { title: "Audit log" };
const LIMIT = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditFilters & { offset?: string; action?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireAdmin();
  const offset = Math.max(0, Number(sp.offset) || 0);
  const f: AuditFilters = { who: sp.who, type: sp.type, q: sp.q ?? sp.action, from: sp.from, to: sp.to, lead: sp.lead, id: sp.id };
  const sb = await createClient();
  const refs = await loadRefs();
  const names = nameMaps(refs);
  const { data, count, error } = await auditQuery(sb, profile.company_id, f, offset, offset + LIMIT - 1);
  const rows = (data ?? []) as unknown as AuditRow[];
  const params = { who: f.who, type: f.type, q: f.q, from: f.from, to: f.to, lead: f.lead, id: f.id };
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const filtered = Object.values(params).some(Boolean);

  return (
    <>
      <PageHeader icon="clock" tone="navy" title="Audit log" sub="Who changed what, and when. Lead edits, status and owner changes, user changes and admin actions."
        actions={<a className="btn-ghost" href={`/api/export/audit${qs ? `?${qs}` : ""}`}><Icon name="download" className="h-4 w-4" />Excel</a>} />
      <form className="card mb-3 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-7">
        <label className="col-span-2 sm:col-span-1"><span className="label"><Tx>Who</Tx></span>
          <select className="input" name="who" defaultValue={f.who ?? ""}>
            <option value="">Everyone</option><option value="system">System / automation</option>
            {refs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </label>
        <label><span className="label">Type</span>
          <select className="input" name="type" defaultValue={f.type ?? ""}>
            <option value="">All</option>{Object.entries(AUDIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span className="label"><Tx>Lead</Tx></span><input className="input" name="lead" defaultValue={f.lead} placeholder="LB-123" /></label>
        <label><span className="label"><Tx>From</Tx></span><input className="input" type="date" name="from" defaultValue={f.from} /></label>
        <label><span className="label"><Tx>To</Tx></span><input className="input" type="date" name="to" defaultValue={f.to} /></label>
        <label><span className="label"><Tx>Action</Tx></span><input className="input" name="q" defaultValue={f.q} placeholder="e.g. status, user" /></label>
        <div className="flex items-end gap-2">
          {f.id && <input type="hidden" name="id" value={f.id} />}
          <button className="btn-primary">Filter</button>
          {filtered && <Link href="/admin/audit" className="btn-ghost">Clear</Link>}
        </div>
      </form>
      {error && <ErrorBox message={error.message} />}
      {!error && !rows.length ? <div className="card"><Empty title="No audit entries">{filtered ? "Nothing matches these filters." : "Changes made from now on show up here."}</Empty></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th"><Tx>When</Tx></th><th className="th"><Tx>Who</Tx></th><th className="th"><Tx>What</Tx></th><th className="th"><Tx>Details</Tx></th></tr></thead>
            <tbody className="divide-y">
              {rows.map((a) => {
                const ch = changesOf(a, names);
                const subj = subjectOf(a, names);
                const leadLink = a.entity === "lead" && a.entity_id && !a.action.includes("delete_permanent");
                return (
                  <tr key={a.id} className="align-top">
                    <td className="td whitespace-nowrap text-xs text-slate-600">{fmtDateTime(a.created_at)}</td>
                    <td className="td whitespace-nowrap">{a.actor?.full_name ?? <span className="text-slate-400">System</span>}</td>
                    <td className="td">
                      <div className="font-medium text-navy-900">{actionLabel(a.action)}</div>
                      {subj && (leadLink ? <Link href={`/leads/${a.entity_id}`} className="text-xs font-semibold text-brand-700 hover:underline">{subj}</Link> : <div className="max-w-xs truncate text-xs text-slate-500" title={subj}>{subj}</div>)}
                    </td>
                    <td className="td">
                      {ch.length ? (
                        <ul className="space-y-0.5 text-xs">
                          {ch.map((c) => (
                            <li key={c.field}><span className="font-semibold text-slate-700">{c.field}:</span> <span className="text-slate-500 line-through decoration-slate-300">{c.from}</span> <span className="text-slate-400">→</span> <span className="font-medium text-navy-900">{c.to}</span></li>
                          ))}
                        </ul>
                      ) : <span className="font-mono text-[11px] text-slate-400">{a.action}</span>}
                      {leadLink && <Link href={`/admin/audit?id=${a.entity_id}`} className="mt-1 inline-block text-[11px] text-slate-500 hover:text-brand-700 hover:underline">Full history of this lead</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={count ?? 0} limit={LIMIT} offset={offset} params={params} basePath="/admin/audit" />
    </>
  );
}
