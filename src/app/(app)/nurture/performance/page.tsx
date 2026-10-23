import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { money, fmtDateTime, daysAgoIso } from "@/lib/dates";

export const metadata = { title: "Attribution" };

export default async function PerformancePage() {
  const sb = await createClient();
  const since = daysAgoIso(90);
  const [{ data: attr }, { data: journeys }, { data: campaigns }, { data: sent }, { data: enr }, { data: msgEv }] = await Promise.all([
    sb.from("lb_attributions").select("event,amount,journey_id,campaign_id,created_at,lead_id").gte("created_at", since).order("created_at", { ascending: false }),
    sb.from("lb_journeys").select("id,name"),
    sb.from("lb_campaigns").select("id,name"),
    sb.from("lb_messages").select("journey_id,campaign_id,status").eq("automated", true).gte("created_at", since).limit(10000),
    sb.from("lb_journey_enrollments").select("id,journey_id,version,status,lead_id").gte("created_at", since).limit(20000),
    sb.from("lb_journey_events").select("enrollment_id,event").in("event", ["message_queued", "reply_received"]).gte("created_at", since).limit(50000),
  ]);
  const queued = new Set((msgEv ?? []).filter((e) => e.event === "message_queued").map((e) => e.enrollment_id));
  const replied = new Set((msgEv ?? []).filter((e) => e.event === "reply_received").map((e) => e.enrollment_id));
  const replyLeads = new Set((attr ?? []).filter((a) => a.event === "reply").map((a) => `${a.journey_id}:${a.lead_id}`));
  const convByLead = new Map((attr ?? []).filter((a) => a.event === "conversion" && a.journey_id).map((a) => [`${a.journey_id}:${a.lead_id}`, Number(a.amount ?? 0)]));
  const jName = new Map((journeys ?? []).map((j) => [j.id, j.name]));
  const funnel = [...(enr ?? []).reduce((m, e) => m.set(`${e.journey_id}|${e.version}`, [...(m.get(`${e.journey_id}|${e.version}`) ?? []), e]), new Map<string, NonNullable<typeof enr>>()).entries()].map(([k, list]) => {
    const [jid, ver] = k.split("|");
    const conv = list.filter((e) => convByLead.has(`${jid}:${e.lead_id}`));
    return { jid, ver, name: jName.get(jid) ?? "—", enrolled: list.length, messaged: list.filter((e) => queued.has(e.id)).length,
      replied: list.filter((e) => replied.has(e.id) || replyLeads.has(`${jid}:${e.lead_id}`)).length, converted: conv.length,
      revenue: conv.reduce((a, e) => a + (convByLead.get(`${jid}:${e.lead_id}`) ?? 0), 0),
      failed: list.filter((e) => e.status === "failed").length, stopped: list.filter((e) => e.status === "stopped").length };
  }).sort((a, b) => a.name.localeCompare(b.name) || Number(b.ver) - Number(a.ver));
  const rows = [
    ...(journeys ?? []).map((j) => ({ key: `j:${j.id}`, kind: "Journey", name: j.name, href: `/nurture/journeys/${j.id}`, match: (x: { journey_id: string | null }) => x.journey_id === j.id })),
    ...(campaigns ?? []).map((c) => ({ key: `c:${c.id}`, kind: "Campaign", name: c.name, href: `/nurture/campaigns/${c.id}`, match: (x: { campaign_id: string | null }) => x.campaign_id === c.id })),
  ].map((r) => {
    const msgs = (sent ?? []).filter(r.match);
    const a = (attr ?? []).filter(r.match);
    const conv = a.filter((x) => x.event === "conversion");
    return { ...r, sent: msgs.filter((m) => m.status !== "failed" && m.status !== "queued").length, failed: msgs.filter((m) => m.status === "failed").length,
      read: msgs.filter((m) => m.status === "read").length, replies: a.filter((x) => x.event === "reply").length, conversions: conv.length,
      revenue: conv.reduce((s, x) => s + Number(x.amount ?? 0), 0) };
  }).filter((r) => r.sent + r.failed + r.replies + r.conversions > 0);
  return (
    <>
      <PageHeader title="Journey & campaign performance (last 90 days)"
        sub="A reply is credited to the most recent automated message to that customer within 7 days; a conversion (Won) and its won value to the most recent delivered automated message within 30 days. Each lead's conversion is credited once." />
      {!rows.length ? <Empty title="No automated activity yet" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-slate-50"><tr><th className="th">Journey / campaign</th><th className="th">Sent</th><th className="th">Read</th><th className="th">Failed</th><th className="th">Replies</th><th className="th">Reply rate</th><th className="th">Conversions</th><th className="th">Revenue</th></tr></thead>
            <tbody className="divide-y">{rows.map((r) => (
              <tr key={r.key}>
                <td className="td"><span className="text-xs text-slate-500">{r.kind}</span> <Link className="font-medium text-brand-700 hover:underline" href={r.href}>{r.name}</Link></td>
                <td className="td">{r.sent}</td><td className="td">{r.read}</td><td className="td">{r.failed}</td><td className="td">{r.replies}</td>
                <td className="td">{r.sent ? `${((r.replies / r.sent) * 100).toFixed(1)}%` : "—"}</td><td className="td">{r.conversions}</td><td className="td">{money(r.revenue)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {funnel.length > 0 && (
        <section className="card mt-4 overflow-x-auto">
          <h2 className="px-4 pt-4 text-sm font-semibold text-navy-900">Journey funnel by version</h2>
          <p className="px-4 text-xs text-slate-500">Enrolments started in the last 90 days. Messaged = at least one template queued; replied = reply during the journey or credited reply; converted = credited conversion. Rate = converted ÷ enrolled.</p>
          <table className="mt-2 w-full min-w-[820px] text-sm">
            <thead className="border-b bg-slate-50"><tr><th className="th">Journey</th><th className="th">Version</th><th className="th">Enrolled</th><th className="th">Messaged</th><th className="th">Replied</th><th className="th">Converted</th><th className="th">Rate</th><th className="th">Revenue</th><th className="th">Stopped / failed</th></tr></thead>
            <tbody className="divide-y">{funnel.map((f) => (
              <tr key={`${f.jid}${f.ver}`}>
                <td className="td"><Link className="text-brand-700 hover:underline" href={`/nurture/journeys/${f.jid}`}>{f.name}</Link></td><td className="td">v{f.ver}</td>
                <td className="td">{f.enrolled}</td><td className="td">{f.messaged}</td><td className="td">{f.replied}</td><td className="td">{f.converted}</td>
                <td className="td">{f.enrolled ? `${((f.converted / f.enrolled) * 100).toFixed(1)}%` : "—"}</td><td className="td">{money(f.revenue)}</td>
                <td className="td text-xs">{f.stopped} / <span className={f.failed ? "text-red-700" : ""}>{f.failed}</span></td>
              </tr>))}</tbody>
          </table>
        </section>
      )}
      {!!attr?.length && (
        <section className="card mt-4 p-4 text-sm">
          <h2 className="mb-2 font-semibold text-navy-900">Latest attributed conversions</h2>
          <ul className="divide-y">{attr.filter((a) => a.event === "conversion").slice(0, 20).map((a, i) => (
            <li key={i} className="flex justify-between py-1.5"><Link className="text-brand-700 hover:underline" href={`/leads/${a.lead_id}`}>Lead</Link><span>{money(a.amount)}</span><span className="text-xs text-slate-400">{fmtDateTime(a.created_at)}</span></li>))}</ul>
        </section>
      )}
    </>
  );
}
