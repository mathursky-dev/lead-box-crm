import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { Kpi, Panel, EmptyState, Icon } from "../ui";

export const metadata = { title: "Campaigns · WhatsApp" };
const STATE_STYLE: Record<string, string> = {
  draft: "bg-slate-100", pending_approval: "bg-amber-50 text-amber-800", approved: "bg-sky-50 text-sky-700",
  running: "bg-brand-100 text-brand-700", completed: "bg-slate-200", cancelled: "bg-red-50 text-red-700",
};

export default async function Campaigns() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: campaigns } = await sb.from("lb_campaigns").select("id,name,status,template_name,template_language,scheduled_at,launched_at,created_at,segment:lb_segments(name),number:lb_wa_numbers(label)").order("created_at", { ascending: false }).limit(100);
  const ids = (campaigns ?? []).map((c) => c.id);
  const [{ data: recips }, { data: msgs }] = ids.length ? await Promise.all([
    sb.from("lb_campaign_recipients").select("campaign_id,status").in("campaign_id", ids).limit(20000),
    sb.from("lb_messages").select("campaign_id,status").in("campaign_id", ids).limit(20000),
  ]) : [{ data: [] }, { data: [] }];
  const stat = (id: string) => {
    const r = (recips ?? []).filter((x) => x.campaign_id === id);
    const m = (msgs ?? []).filter((x) => x.campaign_id === id);
    return { total: r.length, skipped: r.filter((x) => x.status === "skipped").length, sent: m.filter((x) => ["sent", "delivered", "read"].includes(x.status)).length,
      delivered: m.filter((x) => ["delivered", "read"].includes(x.status)).length, read: m.filter((x) => x.status === "read").length, failed: m.filter((x) => x.status === "failed").length };
  };
  const manage = can(profile, "campaigns.manage") || can(profile, "campaigns.approve");
  const all = campaigns ?? [];
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Campaigns" value={all.length} sub={`${all.filter((c) => c.status === "draft").length} drafts`} icon="megaphone" tone="amber" />
        <Kpi label="Waiting approval" value={all.filter((c) => c.status === "pending_approval").length} sub="approve in Nurture → Campaigns" icon="clock" tone="violet" />
        <Kpi label="Running" value={all.filter((c) => c.status === "running").length} sub="sending now, throttled" icon="send" tone="blue" />
        <Kpi label="Completed" value={all.filter((c) => c.status === "completed").length} icon="check" tone="green" />
      </div>
      <Panel title="Campaigns" icon="megaphone" actions={manage ? <><Link href="/nurture/segments" className="btn-ghost btn-sm">Segments</Link><Link href="/nurture/campaigns" className="btn-primary btn-sm"><Icon name="plus" className="h-3.5 w-3.5" /> New campaign</Link></> : null}>
        {!all.length ? <EmptyState icon="megaphone" title="No campaigns yet" action={manage ? <Link href="/nurture/campaigns" className="btn-primary">Create a campaign</Link> : null}>
          Pick a segment, an approved template and a number. Every recipient is checked for consent, suppression, frequency cap and quiet hours right before sending.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Campaign</th><th className="th">Audience</th><th className="th">Template</th><th className="th">When</th><th className="th">Sent</th><th className="th">Delivered</th><th className="th">Read</th><th className="th">Failed</th><th className="th">Status</th></tr></thead>
              <tbody className="divide-y">
                {all.map((c) => {
                  const s = stat(c.id);
                  return (
                    <tr key={c.id}>
                      <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/nurture/campaigns/${c.id}`}>{c.name}</Link><div className="text-xs text-slate-500">{(c.number as unknown as { label: string } | null)?.label}</div></td>
                      <td className="td">{(c.segment as unknown as { name: string } | null)?.name}<div className="text-xs text-slate-500">{s.total} recipients{s.skipped ? ` · ${s.skipped} skipped` : ""}</div></td>
                      <td className="td font-mono text-xs">{c.template_name}</td>
                      <td className="td text-xs">{c.launched_at ? fmtDateTime(c.launched_at) : c.scheduled_at ? fmtDateTime(c.scheduled_at) : "On approval"}</td>
                      <td className="td">{s.sent}</td><td className="td">{s.delivered}</td><td className="td">{s.read}</td><td className="td text-red-600">{s.failed || ""}</td>
                      <td className="td"><span className={`badge ${STATE_STYLE[c.status]}`}>{c.status.replace("_", " ")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
