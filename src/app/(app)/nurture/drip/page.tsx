import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, Empty } from "@/components/static";
import { dripDays } from "@/lib/drip";
import { JourneyButtons } from "../journeys/journey-buttons";

export const metadata = { title: "Drip campaigns" };

const STATE: Record<string, string> = { draft: "bg-slate-100", active: "bg-brand-100 text-brand-700", paused: "bg-amber-50 text-amber-800" };

export default async function DripPage() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const refs = await loadRefs();
  const { data: journeys } = await sb.from("lb_journeys").select("id,name,status,trigger_type,trigger_config,current_version")
    .eq("company_id", profile.company_id).eq("trigger_config->>drip", "true").neq("status", "archived").order("created_at");
  const ids = (journeys ?? []).map((j) => j.id);
  const [{ data: steps }, { data: enr }] = ids.length ? await Promise.all([
    sb.from("lb_journey_steps").select("journey_id,step_no,type,config").in("journey_id", ids).order("step_no"),
    sb.from("lb_journey_enrollments").select("journey_id,status").in("journey_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const statusName = new Map(refs.statuses.map((s) => [s.id, s.name]));
  const sourceName = new Map(refs.sources.map((s) => [s.id, s.name]));
  const count = (j: string, st: string) => (enr ?? []).filter((e) => e.journey_id === j && e.status === st).length;
  const manage = can(profile, "journeys.manage");

  return (
    <>
      <PageHeader icon="clock" tone="violet" title="Drip campaigns"
        sub="Day-wise WhatsApp messages that start automatically when a lead is created or moves to a status. Example: Day 0 welcome, Day 1 brochure, Day 3 offer. Approved templates only; opt-in, quiet hours and the daily cap are checked before every send."
        actions={manage ? <Link className="btn-primary" href="/nurture/drip/new">+ New drip</Link> : null} />
      {!journeys?.length ? (
        <Empty title="No drip campaigns yet" icon="clock">
          {manage ? <>Create one to follow up every lead automatically, day by day. <Link className="text-brand-700 hover:underline" href="/nurture/drip/new">Create a drip</Link></> : "Ask an admin to set up a drip campaign."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50"><tr>
              <th className="th">Drip</th><th className="th">Starts when</th><th className="th">Messages</th><th className="th">Running</th><th className="th">Finished</th><th className="th">Stopped</th><th className="th"></th>
            </tr></thead>
            <tbody className="divide-y">{journeys.map((j) => {
              const c = (j.trigger_config ?? {}) as Record<string, string>;
              const days = dripDays((steps ?? []).filter((s) => s.journey_id === j.id) as { type: string; config: Record<string, unknown> }[]);
              return (
                <tr key={j.id}>
                  <td className="td">
                    <Link className="font-medium text-brand-700 hover:underline" href={`/nurture/drip/${j.id}`}>{j.name}</Link>
                    <span className={`badge ml-1 capitalize ${STATE[j.status] ?? ""}`}>{j.status === "draft" ? "off" : j.status}</span>
                  </td>
                  <td className="td text-xs">
                    {j.trigger_type === "lead_created" ? "New lead is created" : `Lead moves to ${statusName.get(c.status_id) ?? c.category ?? "a status"}`}
                    {c.source_id && <span className="text-slate-500"> · source {sourceName.get(c.source_id) ?? "?"}</span>}
                  </td>
                  <td className="td"><div className="flex flex-wrap gap-1">{days.map((d, i) => <span key={i} className="badge bg-violet-50 text-violet-700">Day {d}</span>)}</div></td>
                  <td className="td">{count(j.id, "active") + count(j.id, "paused")}</td>
                  <td className="td">{count(j.id, "completed")}</td>
                  <td className="td">{count(j.id, "stopped")}</td>
                  <td className="td text-right">{manage && <JourneyButtons id={j.id} status={j.status} published={j.current_version > 0} />}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        A drip is a simple journey: you can also open it under <Link className="text-brand-700 hover:underline" href="/nurture/journeys">Journeys</Link> to see each lead&apos;s progress and the execution log.
        One drip or journey runs per lead at a time; when the lead moves to another status that has its own drip, the new one takes over.
      </p>
    </>
  );
}
