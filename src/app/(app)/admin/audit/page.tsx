import { createClient } from "@/lib/supabase/server";
import { PageHeader, Pager, Empty, ErrorBox } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Audit log" };
const LIMIT = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ offset?: string; action?: string }> }) {
  const sp = await searchParams;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const sb = await createClient();
  let q = sb.from("lb_audit_log").select("id,action,entity,entity_id,data,created_at,actor:lb_profiles!lb_audit_log_actor_id_fkey(full_name)", { count: "exact" })
    .order("created_at", { ascending: false }).range(offset, offset + LIMIT - 1);
  if (sp.action) q = q.ilike("action", `${sp.action}%`);
  const { data, count, error } = await q;
  return (
    <>
      <PageHeader icon="clock" tone="navy" title="Audit log" sub="Admin and sensitive actions. Lead status/assignment history is on each lead." />
      <form className="mb-3 flex gap-2"><input className="input max-w-xs" name="action" defaultValue={sp.action} placeholder="Filter by action, e.g. user." /><button className="btn-ghost">Filter</button></form>
      {error && <ErrorBox message={error.message} />}
      {!error && !data?.length ? <Empty title="No audit entries" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Details</th></tr></thead>
            <tbody className="divide-y">
              {data?.map((a) => (
                <tr key={a.id}>
                  <td className="td whitespace-nowrap">{fmtDateTime(a.created_at)}</td>
                  <td className="td">{(a.actor as unknown as { full_name: string } | null)?.full_name ?? "System"}</td>
                  <td className="td font-mono text-xs">{a.action}</td>
                  <td className="td max-w-md truncate font-mono text-xs text-slate-500" title={JSON.stringify(a.data)}>{a.entity} {a.entity_id ?? ""} {JSON.stringify(a.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={count ?? 0} limit={LIMIT} offset={offset} params={{ action: sp.action }} basePath="/admin/audit" />
    </>
  );
}
