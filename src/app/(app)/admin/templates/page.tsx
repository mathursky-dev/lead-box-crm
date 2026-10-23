import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { requireProfile } from "@/lib/auth";
import { TemplateForm, SyncButton } from "./template-form";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const [{ data }, { data: numbers }] = await Promise.all([
    sb.from("lb_wa_templates").select("*").neq("status", "DELETED").order("name"),
    sb.from("lb_wa_numbers").select("id,label").eq("is_active", true).order("label"),
  ]);
  const admin = ["company_admin", "super_admin"].includes(profile.role);
  return (
    <>
      <PageHeader title="Message templates" sub="Submit new templates to Meta here, or create them in WhatsApp Manager and sync. Only APPROVED templates can be sent; MARKETING templates are blocked for opted-out customers."
        actions={admin && numbers?.length ? <span className="flex flex-wrap gap-2">{numbers.map((n) => <SyncButton key={n.id} id={n.id} label={n.label} />)}<TemplateForm numbers={numbers} /></span> : null} />
      {!data?.length ? <Empty title="No templates synced" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b bg-slate-50"><tr><th className="th">Name</th><th className="th">Language</th><th className="th">Category</th><th className="th">Status</th><th className="th">Body</th><th className="th">Synced</th></tr></thead>
            <tbody className="divide-y">
              {data.map((t) => {
                const body = (t.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")?.text;
                return (
                  <tr key={t.id}>
                    <td className="td font-mono text-xs">{t.name}</td><td className="td">{t.language}</td><td className="td">{t.category}</td>
                    <td className="td"><span className={`badge ${t.status === "APPROVED" ? "bg-brand-100 text-brand-700" : t.status === "REJECTED" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-700"}`}>{t.status}</span></td>
                    <td className="td max-w-md whitespace-pre-wrap text-xs text-slate-600">{body}</td>
                    <td className="td text-xs">{fmtDateTime(t.synced_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
