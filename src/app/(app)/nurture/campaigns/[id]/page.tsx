import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { fmtDateTime, money } from "@/lib/dates";
import { CampaignButtons } from "./buttons";
import { CampaignForm } from "../campaign-form";

export const metadata = { title: "Campaign" };
const STATE: Record<string, string> = {
  draft: "bg-slate-100", pending_approval: "bg-amber-50 text-amber-800", approved: "bg-sky-50 text-sky-700",
  running: "bg-brand-100 text-brand-700", completed: "bg-slate-200", cancelled: "bg-red-50 text-red-700",
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: c } = await sb.from("lb_campaigns").select("*, segment:lb_segments(id,name), offer:lb_offers(name,code,valid_to,status), number:lb_wa_numbers(label,waba_id)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const manage = can(profile, "campaigns.manage"), approve = can(profile, "campaigns.approve");
  const [{ data: preview }, { data: recips }, { data: attr }, { data: tpl }, { data: company }, edit] = await Promise.all([
    manage ? sb.rpc("lb_segment_preview", { p_segment: c.segment_id }) : Promise.resolve({ data: null }),
    sb.from("lb_campaign_recipients").select("status,reason").eq("campaign_id", id),
    sb.from("lb_attributions").select("event,amount").eq("campaign_id", id),
    sb.from("lb_wa_templates").select("components,category").eq("name", c.template_name).eq("language", c.template_language).eq("waba_id", (c.number as { waba_id: string }).waba_id).maybeSingle(),
    sb.from("lb_companies").select("quiet_hours_start,quiet_hours_end,marketing_cap_per_week").eq("id", profile.company_id).single(),
    manage && ["draft", "pending_approval"].includes(c.status) ? Promise.all([
      sb.from("lb_segments").select("id,name").order("name"), sb.from("lb_offers").select("id,name,status"),
      sb.from("lb_wa_numbers").select("id,label,waba_id").eq("is_active", true), sb.from("lb_wa_templates").select("name,language,category,waba_id,components").eq("status", "APPROVED"),
    ]) : Promise.resolve(null),
  ]);
  const p = preview as { total: number; eligible: number; opted_out: number; no_consent: number; suppressed: number; sample: { name: string | null; phone_e164: string }[] } | null;
  const offer = c.offer as { name: string; code: string | null; valid_to: string; status: string } | null;
  const body = ((tpl?.components as { type: string; text?: string }[] | undefined)?.find((x) => x.type === "BODY")?.text) ?? "";
  const sampleName = p?.sample[0]?.name ?? "Customer";
  const rendered = (c.template_params as string[]).map((v) => v.replace(/\{\{name\}\}/g, sampleName).replace(/\{\{first_name\}\}/g, sampleName.split(" ")[0])
    .replace(/\{\{offer_name\}\}/g, offer?.name ?? "").replace(/\{\{offer_code\}\}/g, offer?.code ?? "").replace(/\{\{offer_valid_to\}\}/g, offer ? fmtDateTime(offer.valid_to) : ""));
  const sample = body.replace(/\{\{(\d+)\}\}/g, (_, k) => rendered[Number(k) - 1] ?? `{{${k}}}`);
  const count = (st: string) => (recips ?? []).filter((r) => r.status === st).length;
  const reasons = Object.entries((recips ?? []).filter((r) => r.reason).reduce((a, r) => ({ ...a, [r.reason!]: (a[r.reason!] ?? 0) + 1 }), {} as Record<string, number>));
  const conv = (attr ?? []).filter((a) => a.event === "conversion");
  const tplT = tpl as { category: string } | null;
  return (
    <>
      <PageHeader title={c.name} sub={<><Link className="text-brand-700 hover:underline" href="/nurture/campaigns">← Campaigns</Link> · <span className={`badge ${STATE[c.status]}`}>{c.status.replace("_", " ")}</span></>}
        actions={<span className="flex gap-1">
          {edit && <CampaignForm campaign={{ ...c, template_params: c.template_params as string[] }} segments={edit[0].data ?? []} offers={edit[1].data ?? []} numbers={edit[2].data ?? []}
            templates={(edit[3].data ?? []).map((t) => ({ name: t.name, language: t.language, category: t.category, waba_id: t.waba_id, body: ((t.components as { type: string; text?: string }[]).find((x) => x.type === "BODY")?.text) ?? "" }))} />}
          <CampaignButtons id={c.id} status={c.status} manage={manage} approve={approve} />
        </span>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 text-sm">
          <h2 className="mb-2 font-semibold text-navy-900">Preview</h2>
          <dl className="grid grid-cols-[140px_1fr] gap-y-1">
            <dt className="text-slate-500">Segment</dt><dd>{(c.segment as { name: string }).name}</dd>
            <dt className="text-slate-500">From number</dt><dd>{(c.number as { label: string }).label}</dd>
            <dt className="text-slate-500">Template</dt><dd className="font-mono text-xs">{c.template_name} ({c.template_language}) · {tplT?.category ?? "not approved/synced!"}</dd>
            <dt className="text-slate-500">Offer</dt><dd>{offer ? `${offer.name} · ${offer.status} · valid to ${fmtDateTime(offer.valid_to)}` : "None"}</dd>
            <dt className="text-slate-500">Send at</dt><dd>{c.scheduled_at ? fmtDateTime(c.scheduled_at) : "As soon as approved"}</dd>
            <dt className="text-slate-500">Guards</dt><dd>Quiet hours {company?.quiet_hours_start?.slice(0, 5)}–{company?.quiet_hours_end?.slice(0, 5)} IST · max {company?.marketing_cap_per_week} automated messages per customer per 7 days</dd>
          </dl>
          <div className="mt-3 rounded-lg bg-[#eef2f5] p-3"><div className="max-w-sm whitespace-pre-wrap rounded-lg bg-white p-3 shadow-sm">{sample || "Template body not available."}</div>
            <div className="mt-1 text-[11px] text-slate-500">Sample rendered for {sampleName}</div></div>
        </section>
        <section className="card p-4 text-sm">
          <h2 className="mb-2 font-semibold text-navy-900">Audience & results</h2>
          {p && c.status !== "running" && c.status !== "completed" && (
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="badge bg-brand-100 text-brand-700">{p.eligible} will be messaged</span>
              <span className="badge bg-amber-50 text-amber-800">{p.no_consent} excluded: no opt-in</span>
              <span className="badge bg-red-50 text-red-700">{p.opted_out} excluded: opted out</span>
              <span className="badge bg-slate-200">{p.suppressed} excluded: suppressed</span>
            </div>
          )}
          {(recips?.length ?? 0) > 0 && (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[["Pending", count("pending")], ["Queued", count("queued")], ["Skipped", count("skipped")], ["Failed", count("failed")]].map(([l, v]) => (
                  <div key={l as string} className="rounded border p-2"><div className="text-xl font-semibold">{v}</div><div className="text-xs text-slate-500">{l}</div></div>))}
              </div>
              {reasons.length > 0 && <p className="mt-2 text-xs text-slate-500">Held/skipped: {reasons.map(([k, v]) => `${k.replace(/_/g, " ")} (${v})`).join(", ")}</p>}
            </>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded border p-2"><div className="text-xl font-semibold">{(attr ?? []).filter((a) => a.event === "reply").length}</div><div className="text-xs text-slate-500">Replies</div></div>
            <div className="rounded border p-2"><div className="text-xl font-semibold">{conv.length}</div><div className="text-xs text-slate-500">Conversions</div></div>
            <div className="rounded border p-2"><div className="text-xl font-semibold">{money(conv.reduce((a, x) => a + Number(x.amount ?? 0), 0))}</div><div className="text-xs text-slate-500">Revenue</div></div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Replies within 7 days and conversions (Won) within 30 days of a campaign message are attributed to it.</p>
        </section>
      </div>
    </>
  );
}
