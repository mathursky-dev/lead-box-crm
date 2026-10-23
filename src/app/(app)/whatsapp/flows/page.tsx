import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TRIGGERS } from "../../nurture/journeys/journey-model";
import { Panel, EmptyState, Icon } from "../ui";

export const metadata = { title: "Flows · WhatsApp" };
const TRIGGER = Object.fromEntries(TRIGGERS);
const STATE: Record<string, string> = { draft: "bg-slate-100", active: "bg-brand-100 text-brand-700", paused: "bg-amber-50 text-amber-800" };

const IDEAS: [string, string, string][] = [
  ["Welcome new lead", "A new WhatsApp lead gets a welcome template, a reminder after a day, and an agent task if there is no reply.", "Getting started · lead created"],
  ["Lead qualification", "Ask about requirement and budget with templates, wait for replies, and route hot leads to an agent.", "Sales · status entered"],
  ["Appointment reminder", "When a lead moves to Scheduled: confirmation now, reminder the day before.", "Service · status entered"],
  ["Payment follow-up", "Polite payment reminders on day 1, 3 and 7 until the payment is marked paid.", "Finance · status entered"],
  ["Feedback (NPS)", "After a lead is Won, ask for a 0–10 score and alert the team about low scores.", "Service · status entered"],
  ["Re-engagement", "Lost or cold leads get an offer template after a week, then a final nudge.", "Marketing · segment"],
];

export default async function Flows() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const [{ data: journeys }, { data: enr }] = await Promise.all([
    sb.from("lb_journeys").select("id,name,description,status,trigger_type,current_version,priority").neq("status", "archived").order("priority"),
    sb.from("lb_journey_enrollments").select("journey_id,status").limit(20000),
  ]);
  const count = (id: string, st?: string) => (enr ?? []).filter((e) => e.journey_id === id && (!st || e.status === st)).length;
  const manage = can(profile, "journeys.manage");
  return (
    <>
      <Panel title="Your flows" icon="flow" actions={manage ? <Link href="/nurture/journeys/new" className="btn-primary btn-sm"><Icon name="plus" className="h-3.5 w-3.5" /> New flow</Link> : null}>
        {!journeys?.length ? (
          <EmptyState icon="flow" title="No flows yet" action={manage ? <Link href="/nurture/journeys/new" className="btn-primary">Start from scratch</Link> : null}>
            Build a guided sequence — template messages, waits, conditions, agent tasks and hand-off — that runs on its own for every matching lead.
          </EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {journeys.map((j) => (
              <Link key={j.id} href={`/nurture/journeys/${j.id}`} className="rounded-lg border border-slate-200 p-3 hover:border-indigo-400">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-navy-900">{j.name}</span><span className={`badge ${STATE[j.status] ?? "bg-slate-100"}`}>{j.status}</span></div>
                {j.description && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{j.description}</p>}
                <div className="mt-2 text-xs text-slate-500">{TRIGGER[j.trigger_type] ?? j.trigger_type} · v{j.current_version ?? 0}</div>
                <div className="mt-2 flex gap-3 text-xs"><span><b>{count(j.id, "active")}</b> running</span><span><b>{count(j.id, "completed")}</b> completed</span><span><b>{count(j.id)}</b> total</span></div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
      <div className="mt-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Or start from an idea</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {IDEAS.map(([t, d, tag]) => (
            <div key={t} className="card flex flex-col p-4">
              <div className="font-semibold text-navy-900">{t}</div>
              <p className="mt-1 flex-1 text-sm text-slate-600">{d}</p>
              <div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-500">{tag}</span>
                {manage && <Link href="/nurture/journeys/new" className="btn-ghost btn-sm">Build</Link>}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Flows run on the CRM’s journey engine: consent, frequency caps and quiet hours are rechecked before every send. Instant keyword answers live in <Link className="text-brand-700 hover:underline" href="/whatsapp/chatbots">Chatbots</Link>.</p>
      </div>
    </>
  );
}
