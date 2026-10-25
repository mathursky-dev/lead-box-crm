import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { money } from "@/lib/dates";
import { JourneyButtons } from "./journey-buttons";
import { TRIGGERS } from "./journey-model";

export const metadata = { title: "Journeys" };

const TRIGGER = Object.fromEntries(TRIGGERS);
const STATE: Record<string, string> = { draft: "bg-slate-100", active: "bg-brand-100 text-brand-700", paused: "bg-amber-50 text-amber-800", archived: "bg-slate-200 text-slate-500" };

export default async function JourneysPage() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const [{ data: journeys }, { data: enr }, { data: attr }] = await Promise.all([
    sb.from("lb_journeys").select("*").neq("status", "archived").order("priority"),
    sb.from("lb_journey_enrollments").select("journey_id,status"),
    sb.from("lb_attributions").select("journey_id,event,amount").not("journey_id", "is", null),
  ]);
  const stat = (j: string, st?: string) => (enr ?? []).filter((e) => e.journey_id === j && (!st || e.status === st)).length;
  const att = (j: string, ev: string) => (attr ?? []).filter((a) => a.journey_id === j && a.event === ev);
  const manage = can(profile, "journeys.manage");
  return (
    <>
      <PageHeader icon="flow" tone="violet" title="Nurturing journeys"
        sub="Automated sequences of approved-template messages, agent tasks, waits and branches. One running journey per lead; lower priority number wins conflicts. Drafts never run: preview and publish to create a version. Eligibility, consent, caps and quiet hours are rechecked before every send."
        actions={manage ? <Link className="btn-primary" href="/nurture/journeys/new">+ New journey</Link> : null} />
      {!journeys?.length ? <Empty title="No journeys yet">{manage ? "Create one to start nurturing leads automatically." : "Ask an admin to set up journeys."}</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50"><tr>
              <th className="th">Journey</th><th className="th">Trigger</th><th className="th">Version</th><th className="th">Priority</th><th className="th">Active</th><th className="th">Paused</th>
              <th className="th">Completed</th><th className="th">Failed</th><th className="th">Replies</th><th className="th">Conversions</th><th className="th">Revenue</th><th className="th"></th>
            </tr></thead>
            <tbody className="divide-y">{journeys.map((j) => {
              const conv = att(j.id, "conversion");
              return (
                <tr key={j.id}>
                  <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/nurture/journeys/${j.id}`}>{j.name}</Link> <span className={`badge ml-1 capitalize ${STATE[j.status]}`}>{j.status}</span></td>
                  <td className="td text-xs">{TRIGGER[j.trigger_type]}{j.trigger_config?.category ? `: ${j.trigger_config.category}` : ""}</td>
                  <td className="td">{j.current_version ? `v${j.current_version}` : "—"}</td><td className="td">{j.priority}</td><td className="td">{stat(j.id, "active")}</td><td className="td">{stat(j.id, "paused")}</td>
                  <td className="td">{stat(j.id, "completed")}</td><td className="td">{stat(j.id, "failed") || ""}</td><td className="td">{att(j.id, "reply").length}</td><td className="td">{conv.length}</td>
                  <td className="td">{money(conv.reduce((a, c) => a + Number(c.amount ?? 0), 0))}</td>
                  <td className="td text-right">{manage && <JourneyButtons id={j.id} status={j.status} published={j.current_version > 0} />}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
