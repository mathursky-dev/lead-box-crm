import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { Kpi, Panel, EmptyState, Notice, Icon } from "../../ui";
import { CampaignButtons } from "../../../nurture/campaigns/[id]/buttons";

export const metadata = { title: "Campaign report · WhatsApp" };

type Row = {
  id: string; name: string | null; phone_e164: string; lead_id: string | null; lead_no: number | null; rstatus: string; reason: string | null;
  mstatus: string | null; error_message: string | null; queued_at: string | null; sent_at: string | null; delivered_at: string | null; read_at: string | null;
  failed_at: string | null; replied: boolean; converted: boolean; next_try_at: string | null;
};
type Report = {
  audience: number; waiting: number; skipped: number; queued: number; sent: number; delivered: number; read: number; failed: number; replied: number; converted: number;
  reasons: Record<string, number>; errors: Record<string, number>; rows: Row[];
};
const STATE: Record<string, string> = {
  draft: "bg-slate-100", pending_approval: "bg-amber-50 text-amber-800", approved: "bg-sky-50 text-sky-700",
  running: "bg-brand-100 text-brand-700", completed: "bg-slate-200", cancelled: "bg-red-50 text-red-700",
};
const REASONS: Record<string, string> = {
  no_consent: "No WhatsApp opt-in", opted_out: "Opted out", suppressed: "On suppression list", quiet_hours: "Waiting for quiet hours to end",
  frequency_cap: "Weekly message cap reached", customer_paused: "Automation paused for customer", automation_paused: "Automation paused",
  number_unavailable: "Number not active", template_not_approved: "Template not approved", "campaign cancelled": "Campaign cancelled",
};
const FILTERS = [
  { k: "all", label: "All" }, { k: "read", label: "Read" }, { k: "delivered", label: "Delivered (not read)" }, { k: "sent", label: "Sent" },
  { k: "failed", label: "Failed" }, { k: "skipped", label: "Skipped" }, { k: "waiting", label: "Waiting" }, { k: "replied", label: "Replied" },
] as const;

function stage(r: Row): { label: string; cls: string } {
  if (r.mstatus === "read") return { label: "Read", cls: "bg-sky-50 text-sky-700" };
  if (r.mstatus === "delivered") return { label: "Delivered", cls: "bg-brand-100 text-brand-700" };
  if (r.mstatus === "sent") return { label: "Sent", cls: "bg-slate-100 text-slate-700" };
  if (r.mstatus === "failed" || r.rstatus === "failed") return { label: "Failed", cls: "bg-red-50 text-red-700" };
  if (r.mstatus === "queued" || r.mstatus === "sending") return { label: "Sending", cls: "bg-amber-50 text-amber-800" };
  if (r.rstatus === "skipped") return { label: "Skipped", cls: "bg-slate-200 text-slate-600" };
  return { label: "Waiting", cls: "bg-amber-50 text-amber-800" };
}
const match = (r: Row, f: string) => {
  const s = stage(r).label;
  return f === "all" || (f === "replied" ? r.replied : f === "waiting" ? s === "Waiting" || s === "Sending" : s.toLowerCase() === f);
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function CampaignReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string; new?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: c } = await sb.from("lb_campaigns").select("id,name,status,template_name,template_language,scheduled_at,launched_at,completed_at,created_at,segment:lb_segments(name),number:lb_wa_numbers(label)")
    .eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!c) notFound();
  const manage = can(profile, "campaigns.manage"), approve = can(profile, "campaigns.approve");
  if (!manage) return <Panel title={c.name} icon="megaphone"><EmptyState icon="megaphone" title="No access">The delivery report needs the “Create campaigns &amp; segments” permission.</EmptyState></Panel>;
  const { data, error } = await sb.rpc("lb_campaign_report", { p_campaign: id, p_limit: 2000 });
  const rep = (data ?? null) as Report | null;
  const f = FILTERS.some((x) => x.k === sp.f) ? sp.f! : "all";
  const rows = (rep?.rows ?? []).filter((r) => match(r, f));
  const seg = (c.segment as unknown as { name: string } | null)?.name ?? "";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/whatsapp/campaigns" className="text-xs text-brand-700 hover:underline">← All campaigns</Link>
          <h2 className="text-lg font-semibold text-navy-900">{c.name} <span className={`badge align-middle ${STATE[c.status]}`}>{c.status.replace("_", " ")}</span></h2>
          <p className="text-xs text-slate-500">
            <span className="font-mono">{c.template_name}</span> ({c.template_language}) · from {(c.number as unknown as { label: string } | null)?.label} · audience {seg.replace(/^Broadcast · /, "") === c.name ? "broadcast" : seg}
            {" · "}{c.launched_at ? `started ${fmtDateTime(c.launched_at)}` : c.scheduled_at ? `scheduled ${fmtDateTime(c.scheduled_at)}` : `created ${fmtDateTime(c.created_at)}`}
            {c.completed_at && ` · finished ${fmtDateTime(c.completed_at)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/nurture/campaigns/${c.id}`} className="btn-ghost btn-sm">Campaign details</Link>
          <CampaignButtons id={c.id} status={c.status} manage={manage} approve={approve} />
        </div>
      </div>

      {sp.new === "approved" && <Notice tone="green">Broadcast created. Messages go out within a minute or two (outside quiet hours); this report updates as WhatsApp confirms delivery and reads.</Notice>}
      {sp.new === "pending_approval" && <Notice>Broadcast created and sent for approval. A manager with campaign approval rights must approve it before anything is sent.</Notice>}
      {error && <Notice tone="red">{error.message}</Notice>}

      {rep && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Audience" value={rep.audience} sub={`${rep.skipped} skipped · ${rep.waiting + rep.queued} waiting`} icon="contacts" tone="slate" />
            <Kpi label="Sent" value={rep.sent} sub={pct(rep.sent, rep.audience - rep.skipped) + " of sendable"} icon="send" tone="blue" />
            <Kpi label="Delivered" value={rep.delivered} sub={pct(rep.delivered, rep.sent) + " of sent"} icon="check" tone="green" />
            <Kpi label="Read" value={rep.read} sub={pct(rep.read, rep.delivered) + " of delivered"} icon="eye" tone="violet" />
            <Kpi label="Replied" value={rep.replied} sub={`${rep.converted} converted (won)`} icon="chat" tone="amber" />
            <Kpi label="Failed" value={rep.failed} sub={pct(rep.failed, rep.sent + rep.failed)} icon="alert" tone="red" />
          </div>

          {(Object.keys(rep.reasons).length > 0 || Object.keys(rep.errors).length > 0) && (
            <div className="mb-4 grid gap-4 md:grid-cols-2">
              {Object.keys(rep.reasons).length > 0 && (
                <Panel title="Skipped or waiting, and why" icon="clock">
                  <ul className="space-y-1 text-sm">{Object.entries(rep.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                    <li key={k} className="flex justify-between"><span>{REASONS[k] ?? k.replace(/_/g, " ")}</span><b>{n}</b></li>))}</ul>
                  {rep.reasons.no_consent > 0 && <p className="mt-2 text-xs text-slate-500">Record opt-in on the customer, or tick the opt-in box when sending, to include them next time.</p>}
                </Panel>
              )}
              {Object.keys(rep.errors).length > 0 && (
                <Panel title="Failure reasons from WhatsApp" icon="alert" tone="red">
                  <ul className="space-y-1 text-sm">{Object.entries(rep.errors).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                    <li key={k} className="flex justify-between gap-3"><span className="text-slate-700">{k}</span><b>{n}</b></li>))}</ul>
                </Panel>
              )}
            </div>
          )}

          <Panel title="Recipients" icon="list" sub={rep.rows.length >= 2000 ? "Latest 2,000 shown" : undefined}>
            <nav className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {FILTERS.map((x) => {
                const n = (rep.rows ?? []).filter((r) => match(r, x.k)).length;
                return <Link key={x.k} href={`?f=${x.k}`} className={`rounded-full border px-2.5 py-1 ${f === x.k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 hover:bg-slate-50"}`}>{x.label} <span className="opacity-70">{n}</span></Link>;
              })}
            </nav>
            {rows.length === 0 ? <EmptyState icon="contacts" title={rep.audience ? "Nobody in this group" : "No recipients yet"}>{rep.audience ? "Pick another filter." : "Recipients are added when the campaign starts."}</EmptyState> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50"><tr><th className="th">Customer</th><th className="th">Lead</th><th className="th">Status</th><th className="th">Sent</th><th className="th">Delivered</th><th className="th">Read</th><th className="th">Note</th></tr></thead>
                  <tbody className="divide-y">
                    {rows.map((r) => {
                      const s = stage(r);
                      return (
                        <tr key={r.id}>
                          <td className="td"><div className="font-medium text-navy-900">{r.name || "—"}</div><div className="text-xs text-slate-500">{r.phone_e164}</div></td>
                          <td className="td">{r.lead_id ? <Link className="text-brand-700 hover:underline" href={`/leads/${r.lead_id}`}>LB-{r.lead_no}</Link> : "—"}</td>
                          <td className="td"><span className={`badge ${s.cls}`}>{s.label}</span>{r.replied && <span className="badge ml-1 bg-amber-50 text-amber-800"><Icon name="chat" className="mr-0.5 inline h-3 w-3" />Replied</span>}</td>
                          <td className="td text-xs text-slate-500">{r.sent_at ? fmtDateTime(r.sent_at) : "—"}</td>
                          <td className="td text-xs text-slate-500">{r.delivered_at ? fmtDateTime(r.delivered_at) : "—"}</td>
                          <td className="td text-xs text-slate-500">{r.read_at ? fmtDateTime(r.read_at) : "—"}</td>
                          <td className="td max-w-xs text-xs text-slate-500">{r.error_message || (r.reason ? (REASONS[r.reason] ?? r.reason.replace(/_/g, " ")) + (s.label === "Waiting" && r.next_try_at ? ` · retry ${fmtDateTime(r.next_try_at)}` : "") : "")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
