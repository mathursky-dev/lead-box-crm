import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { Panel, Table } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Data export" };

export default async function ExportPage() {
  const { profile, company } = await requireAdmin();
  const sb = await createClient();
  const { data: past } = await sb.from("lb_audit_log").select("created_at,actor_id,data").eq("company_id", profile.company_id).eq("action", "company.export").order("created_at", { ascending: false }).limit(10);
  const { data: people } = await sb.from("lb_profiles").select("id,full_name").eq("company_id", profile.company_id);
  const name = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
  return (
    <>
      <PageHeader icon="download" tone="navy" title="Data export / backup" sub={`Download everything of ${company?.name ?? "your company"} in one click.`} />
      <Panel title="Full company backup" icon="download">
        <div className="space-y-3 text-sm">
          <p>One ZIP file with every table as a CSV that opens in Excel: leads, statuses, follow-ups, notes, chats and messages, customers, tasks, calls, quotes and invoices, payments, store orders, field visits, expenses, users, settings and more.</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Passwords, API tokens and secret keys are never included.</li>
            <li>Large companies can take a minute or two. Up to 5 exports per hour.</li>
            <li>Every export is written to the audit log.</li>
          </ul>
          <a href="/api/export/company" className="btn-primary inline-flex" download>Download full backup (ZIP)</a>
        </div>
      </Panel>
      <Panel title="Recent exports" icon="clock" className="mt-4">
        <Table head={["When", "By", "Tables"]} empty={past?.length ? undefined : "No full exports yet."}>
          {(past ?? []).map((p, i) => (
            <tr key={i}><td className="td">{fmtDateTime(p.created_at)}</td><td className="td">{name.get(p.actor_id) ?? "—"}</td><td className="td">{(p.data as { tables?: number })?.tables ?? "—"}</td></tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
