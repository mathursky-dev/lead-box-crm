import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox, Empty, Pager } from "@/components/static";
import { fmtDateTime, money } from "@/lib/dates";
import { QueueActions, AutomationSwitch } from "./queue-actions";

export const metadata = { title: "Nurture & Recovery" };

const QUEUES: { key: string; title: string; sub: string; tone: string }[] = [
  { key: "unassigned", title: "Unassigned enquiries", sub: "Open leads with no owner", tone: "text-amber-700" },
  { key: "unanswered", title: "Unanswered customers", sub: "Customer messaged last; waiting for us", tone: "text-red-700" },
  { key: "overdue", title: "Overdue follow-ups", sub: "Next action date has passed", tone: "text-red-700" },
  { key: "no_next_action", title: "Missing next action", sub: "Open leads with nothing scheduled", tone: "text-amber-700" },
  { key: "hot", title: "Hot leads", sub: "High/urgent or interested/scheduled, active this week", tone: "text-brand-700" },
  { key: "payments", title: "Pending payments", sub: "Payment pending or partial", tone: "text-amber-700" },
  { key: "failed", title: "Failed messages", sub: "Sends that failed in the last 14 days", tone: "text-red-700" },
  { key: "recovery", title: "Recovery", sub: "Open leads untouched for 14+ days", tone: "text-navy-700" },
  { key: "journeys", title: "Journeys paused", sub: "Paused: customer replied or manual hold", tone: "text-navy-700" },
  { key: "failed_jobs", title: "Failed automation", sub: "Journey steps / jobs that exhausted retries", tone: "text-red-700" },
  { key: "complaints", title: "Open complaints", sub: "Marketing is suppressed until resolved", tone: "text-red-700" },
  { key: "signals", title: "Buying signals", sub: "Detected in the last 48 hours", tone: "text-brand-700" },
];
const LIMIT = 50;

type Row = Record<string, unknown> & { kind: string; id: string };

export default async function NurturePage({ searchParams }: { searchParams: Promise<{ q?: string; offset?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: counts, error } = await sb.rpc("lb_nurture_counts");
  const q = QUEUES.find((x) => x.key === sp.q);
  const offset = Math.max(0, Number(sp.offset) || 0);
  let list: { total: number; rows: Row[] } | null = null;
  let listError: string | null = null;
  if (q) {
    const r = await sb.rpc("lb_nurture_queue", { p_queue: q.key, p_limit: LIMIT, p_offset: offset });
    if (r.error) listError = r.error.message; else list = r.data;
  }
  const [{ data: users }, { data: co }] = await Promise.all([
    sb.from("lb_profiles").select("id,full_name").eq("is_active", true).order("full_name"),
    sb.from("lb_companies").select("automation_paused,automation_paused_reason").eq("id", profile.company_id).maybeSingle(),
  ]);
  const control = can(profile, "automation.control");

  return (
    <>
      <PageHeader icon="refresh" tone="green" title="Nurture & Recovery" sub={`Every open lead needs an owner, a next action and a due date. ${profile.role === "agent" ? "Showing your leads and chats." : "Showing everything you can access."}`}
        actions={control && !co?.automation_paused ? <AutomationSwitch paused={false} reason={null} /> : null} />
      {co?.automation_paused && (control ? <AutomationSwitch paused reason={co.automation_paused_reason} />
        : <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">All automation is paused by an admin.</div>)}
      {error && <ErrorBox message={error.message} />}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {QUEUES.map((x) => (
          <Link key={x.key} href={`/nurture?q=${x.key}`} className={`card block p-4 transition hover:border-brand-500 ${sp.q === x.key ? "border-brand-500 ring-2 ring-brand-100" : ""}`}>
            <div className={`text-3xl font-semibold ${(counts?.[x.key] ?? 0) > 0 ? x.tone : "text-slate-400"}`}>{counts?.[x.key] ?? 0}</div>
            <div className="mt-1 text-sm font-medium text-navy-900">{x.title}</div>
            <div className="text-xs text-slate-500">{x.sub}</div>
          </Link>
        ))}
      </section>

      {q && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">{q.title}</h2>
          {listError ? <ErrorBox message={listError} /> : !list?.rows.length ? <Empty title="Nothing here — nice work." /> : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <tbody className="divide-y">
                  {list.rows.map((r) => <QueueRow key={`${r.kind}:${r.id}`} r={r} users={users ?? []} canAssign={profile.role !== "agent"} />)}
                </tbody>
              </table>
            </div>
          )}
          {list && <Pager total={list.total} limit={LIMIT} offset={offset} params={{ q: q.key }} basePath="/nurture" />}
        </section>
      )}
    </>
  );
}

function QueueRow({ r, users, canAssign }: { r: Row; users: { id: string; full_name: string }[]; canAssign: boolean }) {
  const who = (r.customer_name as string) || (r.phone_e164 as string);
  if (r.kind === "lead") return (
    <tr>
      <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/leads/${r.id}`}>LB-{r.lead_no as number}</Link> <span className="text-slate-700">{who}</span>
        <div className="text-xs text-slate-500">{r.status_name as string} · <span className="capitalize">{r.priority as string}</span>{r.payment_status !== "none" ? ` · payment ${r.payment_status}` : ""}</div></td>
      <td className="td text-xs">{(r.owner_name as string) ?? <span className="text-amber-700">Unassigned</span>}</td>
      <td className="td text-xs">Next: {fmtDateTime(r.next_followup_at as string)}<div className="text-slate-500">Last activity {fmtDateTime(r.last_activity_at as string)}</div></td>
      <td className="td text-xs">{r.payment_due_amount ? `${money(r.payment_due_amount as number)} due ${fmtDateTime(r.payment_due_at as string)}` : money(r.expected_value as number)}</td>
      <td className="td text-right"><QueueActions kind="lead" id={r.id} users={canAssign && !r.owner_id ? users : []} /></td>
    </tr>
  );
  if (r.kind === "chat") return (
    <tr>
      <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/inbox?c=${r.id}`}>{who}</Link><div className="truncate text-xs text-slate-500">{r.preview as string}</div></td>
      <td className="td text-xs">{(r.owner_name as string) ?? <span className="text-amber-700">Unassigned</span>}</td>
      <td className="td text-xs">Waiting since {fmtDateTime(r.awaiting_reply_since as string)}</td>
      <td className="td">{r.escalated ? <span className="badge bg-red-100 text-red-700">Escalated</span> : r.sla_breached ? <span className="badge bg-amber-50 text-amber-800">SLA breached</span> : <span className="badge bg-slate-100">Within SLA</span>}</td>
      <td className="td text-right"><Link className="btn-primary btn-sm" href={`/inbox?c=${r.id}`}>Reply</Link></td>
    </tr>
  );
  if (r.kind === "message") return (
    <tr>
      <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/inbox?c=${r.conversation_id}`}>{who}</Link>
        <div className="text-xs text-slate-500">{r.template_name ? `Template ${r.template_name}` : "Message"}{r.automated ? " · automated" : ""}</div></td>
      <td className="td max-w-sm text-xs text-red-700" colSpan={2}>{r.error as string} {r.error_code ? `(${r.error_code})` : ""}</td>
      <td className="td text-xs">{fmtDateTime(r.failed_at as string)}</td>
      <td className="td text-right"><QueueActions kind="message" id={r.id} unknown={r.error_code === "unknown"} /></td>
    </tr>
  );
  if (r.kind === "failed_enrollment" || r.kind === "failed_job") return (
    <tr>
      <td className="td">{r.kind === "failed_job" ? <span className="font-medium">Job: {(r.job as string).replace("_", " ")}</span>
        : <><Link className="font-medium text-brand-700 hover:underline" href={`/leads/${r.lead_id}`}>{who}</Link><div className="text-xs text-slate-500">Journey: {r.journey as string}</div></>}</td>
      <td className="td max-w-sm text-xs text-red-700" colSpan={2}>{r.error as string} <span className="text-slate-500">· {r.attempts as number} attempts</span></td>
      <td className="td text-xs">{fmtDateTime(r.updated_at as string)}</td>
      <td className="td text-right"><QueueActions kind={r.kind} id={r.id} /></td>
    </tr>
  );
  if (r.kind === "complaint" || r.kind === "signal") return (
    <tr>
      <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={r.conversation_id ? `/inbox?c=${r.conversation_id}` : r.lead_id ? `/leads/${r.lead_id}` : `/customers/${r.customer_id}`}>{who}</Link></td>
      <td className="td text-xs" colSpan={2}>{r.kind === "complaint" ? <>{r.source === "keyword" ? `Keyword “${r.matched}”` : "Raised by agent"}{r.note ? ` — ${r.note}` : ""}</> : <>Said “{r.matched as string}”</>}</td>
      <td className="td text-xs">{fmtDateTime(r.created_at as string)}</td>
      <td className="td text-right">{r.kind === "complaint" ? <QueueActions kind="complaint" id={r.id} conv={r.conversation_id as string} />
        : <Link className="btn-primary btn-sm" href={r.conversation_id ? `/inbox?c=${r.conversation_id}` : `/leads/${r.lead_id}`}>Respond</Link>}</td>
    </tr>
  );
  return (
    <tr>
      <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/leads/${r.lead_id}`}>{who}</Link><div className="text-xs text-slate-500">Journey: {r.journey as string}</div></td>
      <td className="td text-xs capitalize" colSpan={2}>{r.status as string}{r.reason ? ` — ${r.reason}` : ""}</td>
      <td className="td text-xs">{fmtDateTime(r.updated_at as string)}</td>
      <td className="td text-right"><QueueActions kind="enrollment" id={r.id} /></td>
    </tr>
  );
}
