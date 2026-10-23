import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { CampaignForm } from "./campaign-form";

export const metadata = { title: "Campaigns" };
const STATE_STYLE: Record<string, string> = {
  draft: "bg-slate-100", pending_approval: "bg-amber-50 text-amber-800", approved: "bg-sky-50 text-sky-700",
  running: "bg-brand-100 text-brand-700", completed: "bg-slate-200", cancelled: "bg-red-50 text-red-700",
};

export default async function CampaignsPage() {
  const { profile } = await requireProfile();
  const manage = can(profile, "campaigns.manage");
  if (!manage && !can(profile, "campaigns.approve")) redirect("/nurture");
  const sb = await createClient();
  const [{ data: campaigns }, { data: segments }, { data: offers }, { data: templates }, { data: numbers }] = await Promise.all([
    sb.from("lb_campaigns").select("*, segment:lb_segments(name)").order("created_at", { ascending: false }),
    sb.from("lb_segments").select("id,name").order("name"),
    sb.from("lb_offers").select("id,name,status").order("created_at", { ascending: false }),
    sb.from("lb_wa_templates").select("name,language,category,waba_id,components").eq("status", "APPROVED").order("name"),
    sb.from("lb_wa_numbers").select("id,label,waba_id").eq("is_active", true).order("label"),
  ]);
  return (
    <>
      <PageHeader title="Campaigns" sub="One-off sends of an approved template to a segment. Draft → approval → scheduled send. Each recipient is checked for consent, suppression, frequency cap, quiet hours and offer validity right before sending."
        actions={manage ? <CampaignForm segments={segments ?? []} offers={offers ?? []} numbers={numbers ?? []}
          templates={(templates ?? []).map((t) => ({ name: t.name, language: t.language, category: t.category, waba_id: t.waba_id, body: ((t.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")?.text) ?? "" }))} /> : null} />
      {!campaigns?.length ? <Empty title="No campaigns yet" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-slate-50"><tr><th className="th">Campaign</th><th className="th">Segment</th><th className="th">Template</th><th className="th">Scheduled</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y">{campaigns.map((c) => (
              <tr key={c.id}>
                <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/nurture/campaigns/${c.id}`}>{c.name}</Link></td>
                <td className="td">{(c.segment as { name: string } | null)?.name}</td>
                <td className="td font-mono text-xs">{c.template_name} ({c.template_language})</td>
                <td className="td text-xs">{c.scheduled_at ? fmtDateTime(c.scheduled_at) : "On approval"}</td>
                <td className="td"><span className={`badge ${STATE_STYLE[c.status]}`}>{c.status.replace("_", " ")}</span></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
