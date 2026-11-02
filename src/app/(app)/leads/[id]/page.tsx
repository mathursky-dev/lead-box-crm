import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { StatusBadge, PRIORITY_STYLE } from "@/components/static";
import { fmtDateTime, money } from "@/lib/dates";
import { Timeline, type Ev } from "@/components/timeline";
import { StatusPanel, AssignPanel, EditPanel, FollowupPanel, ActivityPanel, ChatPanel, PaymentPanel, JourneyPanel } from "./panels";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: lead } = await sb.from("lb_leads").select("*, customer:lb_customers(*), status:lb_lead_statuses(name,category), owner:lb_profiles!lb_leads_owner_id_fkey(full_name,is_active)").eq("id", id).maybeSingle();
  if (!lead) notFound();
  // First open by the owner flips the lead to "seen" in the leads list.
  let seenAt: string | null = lead.owner_seen_at ?? null;
  if (lead.owner_id === profile.id && !seenAt && !(await sb.rpc("lb_mark_lead_seen", { p_lead: id })).error) seenAt = new Date().toISOString();
  const refs = await loadRefs();
  const [{ data: events }, { data: followups }, { data: tags }, { data: convs }, { data: siblings }, { data: enr }, { data: journeys }] = await Promise.all([
    sb.from("lb_lead_events").select("id,type,is_work,reason,data,created_at,to_category,actor_id,from_user_id,to_user_id,from_status_id,to_status_id").eq("lead_id", id).order("created_at", { ascending: false }).limit(200),
    sb.from("lb_followups").select("id,due_at,note,status,assigned_to,completed_at,action_type").eq("lead_id", id).order("due_at", { ascending: false }),
    sb.from("lb_lead_tags").select("tag_id").eq("lead_id", id),
    sb.from("lb_conversations").select("id,status,unread_count,last_message_at,number:lb_wa_numbers(label)").eq("customer_id", lead.customer_id),
    sb.from("lb_leads").select("id,lead_no,status_category,created_at,status:lb_lead_statuses(name)").eq("customer_id", lead.customer_id).neq("id", id).order("created_at", { ascending: false }),
    sb.from("lb_journey_enrollments").select("id,status,status_reason,current_step,next_run_at,journey:lb_journeys(name)").eq("lead_id", id).in("status", ["active", "paused", "failed"]).order("enrolled_at", { ascending: false }).limit(1),
    sb.from("lb_journeys").select("id,name").eq("status", "active").order("priority"),
  ]);
  const pending = (followups ?? []).filter((f) => f.status === "pending").sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  const enrollment = enr?.[0] ? { ...enr[0], journey: (enr[0].journey as unknown as { name: string }).name } : null;
  const c = lead.customer as { id: string; name: string | null; phone_e164: string; email: string | null; location: string | null; wa_opted_out_at: string | null };
  const st = lead.status as { name: string; category: string };
  const subStatusId = (lead as { sub_status_id?: string | null }).sub_status_id ?? null;
  const subSt = subStatusId ? refs.subStatuses.find((x) => x.id === subStatusId) : null;
  const owner = lead.owner as { full_name: string; is_active: boolean } | null;
  const userName = new Map(refs.users.map((u) => [u.id, u.full_name]));
  const statusName = new Map(refs.statuses.map((s) => [s.id, s.name]));
  const tagIds = (tags ?? []).map((t) => t.tag_id);
  const evs: Ev[] = (events ?? []).map((e) => ({
    ...e, actor: e.actor_id ? userName.get(e.actor_id) ?? "User" : "System",
    from_user: e.from_user_id ? userName.get(e.from_user_id) : undefined, to_user: e.to_user_id ? userName.get(e.to_user_id) : undefined,
    from_status: e.from_status_id ? statusName.get(e.from_status_id) : undefined, to_status: e.to_status_id ? statusName.get(e.to_status_id) : undefined,
  }));

  return (
    <div className="space-y-4">
      {created && <div className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">Lead created.</div>}
      <div className="card flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-navy-900">LB-{lead.lead_no}</h1>
            <StatusBadge name={st.name} category={st.category} />
            {subSt && <span className="badge bg-slate-100 text-slate-700">{subSt.name}</span>}
            <span className={`badge capitalize ${PRIORITY_STYLE[lead.priority]}`}>{lead.priority}</span>
            {lead.is_repeat && <span className="badge bg-sky-50 text-sky-700">Repeat opportunity</span>}
          </div>
          <div className="mt-1 text-sm">
            <Link href={`/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name || "Unnamed customer"}</Link>
            <span className="ml-2 text-slate-600">{c.phone_e164}</span>{c.email && <span className="ml-2 text-slate-500">{c.email}</span>}
            {c.wa_opted_out_at && <span className="badge ml-2 bg-red-50 text-red-700">WhatsApp opted out</span>}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Owner: <b>{owner ? `${owner.full_name}${owner.is_active ? "" : " (inactive)"}` : "Unassigned"}</b> · Created {fmtDateTime(lead.created_at)} · Assigned {fmtDateTime(lead.assigned_at)}
            {owner && <> · {seenAt ? <>Seen by owner {fmtDateTime(seenAt)}</> : <span className="text-sky-700">Not yet seen by owner</span>}</>} · Last activity {fmtDateTime(lead.last_activity_at)}
            {lead.converted_at && <> · Converted {fmtDateTime(lead.converted_at)}</>}
          </div>
        </div>
        <div className="text-right text-sm">
          <div>Expected <b>{money(lead.expected_value)}</b></div>
          {lead.won_value != null && <div className="text-brand-700">Won <b>{money(lead.won_value)}</b></div>}
          {lead.lost_reason && <div className="max-w-xs text-xs text-red-700">Reason: {lead.lost_reason}</div>}
          <Link className="btn-ghost btn-sm mt-2" href={`/leads/new?repeat=${lead.id}`}>+ Repeat opportunity</Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {can(profile, "leads.status") && <StatusPanel leadId={lead.id} statusId={lead.status_id} subStatusId={subStatusId} subStatuses={refs.subStatuses} statuses={refs.statuses.filter((s) => s.is_active || s.id === lead.status_id)} expected={lead.expected_value}
            nextAction={pending ? { note: pending.note, due_at: pending.due_at, action_type: (pending as { action_type?: string }).action_type ?? "call" } : null} />}
          <ActivityPanel leadId={lead.id} />
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-navy-900">History</h2>
            <Timeline events={evs} />
          </section>
        </div>
        <div className="space-y-4">
          {can(profile, "leads.assign") && (
            <AssignPanel leadId={lead.id} ownerId={lead.owner_id} users={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))} />
          )}
          {can(profile, "leads.edit") && <PaymentPanel leadId={lead.id} status={lead.payment_status} amount={lead.payment_due_amount} due={lead.payment_due_at} />}
          {can(profile, "nurture.view") && <JourneyPanel leadId={lead.id} enrollment={enrollment} journeys={journeys ?? []} />}
          <FollowupPanel leadId={lead.id} items={(followups ?? []).map((f) => ({ ...f, who: f.assigned_to ? userName.get(f.assigned_to) : undefined }))} />
          <ChatPanel leadId={lead.id} convs={(convs ?? []).map((v) => ({ id: v.id, status: v.status, unread: v.unread_count, last: v.last_message_at, number: (v.number as unknown as { label: string } | null)?.label ?? "" }))}
            numbers={refs.numbers.filter((n) => n.is_active)} />
          {can(profile, "leads.edit") && <EditPanel lead={{ ...lead, name: c.name, email: c.email, location: c.location }} refs={refs} tagIds={tagIds} />}
          {(siblings?.length ?? 0) > 0 && (
            <section className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-navy-900">Other opportunities for this customer</h2>
              <ul className="space-y-1 text-sm">
                {siblings!.map((s) => <li key={s.id}><Link className="text-brand-700 hover:underline" href={`/leads/${s.id}`}>LB-{s.lead_no}</Link> <span className="text-slate-500">{(s.status as unknown as { name: string }).name} · {fmtDateTime(s.created_at)}</span></li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
