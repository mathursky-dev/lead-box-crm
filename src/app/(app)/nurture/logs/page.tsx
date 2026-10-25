import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty, ErrorBox, Pager } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Execution log" };
const LIMIT = 100;
const EVENTS = ["enrolled", "message_queued", "deferred", "skipped", "branch", "send_failed", "ai_summary_requested", "step_done", "waiting_reply", "reply_received", "reply_timeout", "task_created", "assigned",
  "notified", "status_set", "tagged", "paused", "resumed", "retry_scheduled", "failed", "retried", "stopped", "completed"];

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ journey?: string; event?: string; offset?: string }> }) {
  const sp = await searchParams;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const sb = await createClient();
  let q = sb.from("lb_journey_events").select("id,step_no,event,detail,created_at,journey_id,journey:lb_journeys(name),enrollment:lb_journey_enrollments(lead_id,version)", { count: "exact" })
    .order("created_at", { ascending: false }).range(offset, offset + LIMIT - 1);
  if (sp.journey && /^[0-9a-f-]{36}$/i.test(sp.journey)) q = q.eq("journey_id", sp.journey);
  if (sp.event && EVENTS.includes(sp.event)) q = q.eq("event", sp.event);
  const [{ data, count, error }, { data: journeys }] = await Promise.all([q, sb.from("lb_journeys").select("id,name").order("name")]);
  return (
    <>
      <PageHeader icon="pulse" tone="navy" title="Execution log" sub="Every journey step, deferral, retry and stop, newest first. Deferred = held by consent, cap, quiet hours or a pause; it runs later automatically." />
      <form className="mb-3 flex flex-wrap gap-2">
        <select className="input w-56" name="journey" defaultValue={sp.journey ?? ""}><option value="">All journeys</option>{(journeys ?? []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
        <select className="input w-48" name="event" defaultValue={sp.event ?? ""}><option value="">All events</option>{EVENTS.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}</select>
        <button className="btn-ghost">Filter</button>
      </form>
      {error ? <ErrorBox message={error.message} /> : !data?.length ? <Empty title="No events" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">When</th><th className="th">Journey</th><th className="th">Event</th><th className="th">Detail</th><th className="th"></th></tr></thead>
            <tbody className="divide-y">{data.map((e) => {
              const en = e.enrollment as unknown as { lead_id: string; version: number } | null;
              return (
                <tr key={e.id}>
                  <td className="td whitespace-nowrap text-xs">{fmtDateTime(e.created_at)}</td>
                  <td className="td"><Link className="text-brand-700 hover:underline" href={`/nurture/journeys/${e.journey_id}`}>{(e.journey as unknown as { name: string } | null)?.name}</Link>
                    <span className="text-xs text-slate-400">{en?.version ? ` v${en.version}` : ""}{e.step_no ? ` · step ${e.step_no}` : ""}</span></td>
                  <td className={`td text-xs font-medium ${e.event === "failed" ? "text-red-700" : e.event === "deferred" || e.event === "skipped" ? "text-amber-700" : ""}`}>{e.event.replace(/_/g, " ")}</td>
                  <td className="td max-w-md text-xs text-slate-600">{e.detail}</td>
                  <td className="td text-right">{en?.lead_id && <Link className="text-xs text-brand-700 hover:underline" href={`/leads/${en.lead_id}`}>Lead</Link>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <Pager total={count ?? 0} limit={LIMIT} offset={offset} params={{ journey: sp.journey, event: sp.event }} basePath="/nurture/logs" />
    </>
  );
}
