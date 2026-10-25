import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { requireProfile, can } from "@/lib/auth";
import { ConsentForm } from "../../nurture/consent/forms";
import { PageHeader, StatusBadge } from "@/components/static";
import { Timeline, type Ev } from "@/components/timeline";
import { fmtDateTime, money } from "@/lib/dates";

export const metadata = { title: "Customer 360" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: c } = await sb.from("lb_customers").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const refs = await loadRefs();
  const [{ data: leads }, { data: convs }, { data: notes }, { data: consent }] = await Promise.all([
    sb.from("lb_leads").select("id,lead_no,status_category,expected_value,won_value,created_at,owner_id,next_followup_at,status:lb_lead_statuses(name)").eq("customer_id", id).order("created_at", { ascending: false }),
    sb.from("lb_conversations").select("id,status,unread_count,last_message_at,last_message_preview,number:lb_wa_numbers(label)").eq("customer_id", id),
    sb.from("lb_notes").select("id,body,created_at,author_id,lead_id,conversation_id").eq("customer_id", id).order("created_at", { ascending: false }).limit(100),
    sb.from("lb_consent_events").select("id,status,source,note,created_at,actor_id").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const leadIds = (leads ?? []).map((l) => l.id);
  const [{ data: events }, { data: followups }] = await Promise.all([
    leadIds.length ? sb.from("lb_lead_events").select("id,lead_id,type,is_work,reason,data,created_at,actor_id,from_user_id,to_user_id,from_status_id,to_status_id").in("lead_id", leadIds).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    leadIds.length ? sb.from("lb_followups").select("id,lead_id,due_at,note,status").in("lead_id", leadIds).order("due_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const uName = new Map(refs.users.map((u) => [u.id, u.full_name]));
  const sName = new Map(refs.statuses.map((s) => [s.id, s.name]));
  const leadNo = new Map((leads ?? []).map((l) => [l.id, l.lead_no]));
  const evs: Ev[] = (events ?? []).map((e) => ({
    ...e, lead_no: leadNo.get(e.lead_id), actor: e.actor_id ? uName.get(e.actor_id) ?? "User" : "System",
    from_user: e.from_user_id ? uName.get(e.from_user_id) : undefined, to_user: e.to_user_id ? uName.get(e.to_user_id) : undefined,
    from_status: e.from_status_id ? sName.get(e.from_status_id) : undefined, to_status: e.to_status_id ? sName.get(e.to_status_id) : undefined,
  }));
  const won = (leads ?? []).reduce((a, l) => a + (l.status_category === "won" ? Number(l.won_value ?? 0) : 0), 0);

  return (
    <>
      <PageHeader icon="user" tone="violet" title={c.name || c.wa_profile_name || c.phone_e164} sub={<>{c.phone_e164}{c.email ? ` · ${c.email}` : ""}{c.location ? ` · ${c.location}` : ""} · customer since {fmtDateTime(c.created_at)}</>}
        actions={leads?.[0] && <Link className="btn-ghost" href={`/leads/new?repeat=${leads[0].id}`}>+ Repeat opportunity</Link>} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <span className="badge bg-slate-100 text-slate-700">{leads?.length ?? 0} opportunities</span>
        <span className="badge bg-brand-100 text-brand-700">Won {money(won)}</span>
        {c.wa_opted_out_at ? <span className="badge bg-red-50 text-red-700">Opted out {fmtDateTime(c.wa_opted_out_at)}</span>
          : c.wa_opt_in_at ? <span className="badge bg-brand-50 text-brand-700">Opted in {fmtDateTime(c.wa_opt_in_at)}</span> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card p-4"><h2 className="mb-3 text-sm font-semibold text-navy-900">Timeline</h2><Timeline events={evs} /></section>
        </div>
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Leads</h2>
            <ul className="space-y-2 text-sm">{(leads ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <Link className="text-brand-700 hover:underline" href={`/leads/${l.id}`}>LB-{l.lead_no}</Link>
                <StatusBadge name={(l.status as unknown as { name: string }).name} category={l.status_category} />
                <span className="text-xs text-slate-500">{l.owner_id ? uName.get(l.owner_id) : "Unassigned"}</span>
              </li>))}</ul>
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Chats</h2>
            {!convs?.length ? <p className="text-sm text-slate-500">No WhatsApp chats.</p> : <ul className="space-y-2 text-sm">{convs.map((v) => (
              <li key={v.id}><Link className="text-brand-700 hover:underline" href={`/inbox?c=${v.id}`}>{(v.number as unknown as { label: string }).label}</Link>
                <span className="ml-2 text-xs capitalize text-slate-500">{v.status} · {fmtDateTime(v.last_message_at)}</span>
                <div className="truncate text-xs text-slate-500">{v.last_message_preview}</div></li>))}</ul>}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Follow-ups</h2>
            {!followups?.length ? <p className="text-sm text-slate-500">None.</p> : <ul className="space-y-1 text-sm">{followups.map((f) => (
              <li key={f.id}>{fmtDateTime(f.due_at)} <span className="text-xs capitalize text-slate-500">· {f.status} · LB-{leadNo.get(f.lead_id)}</span>{f.note && <div className="text-xs text-slate-500">{f.note}</div>}</li>))}</ul>}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">WhatsApp consent</h2>
            <p className="mb-2 text-sm">{c.wa_opted_out_at ? <span className="text-red-700">Opted out</span> : c.wa_opt_in_at ? <span className="text-brand-700">Opted in</span> : <span className="text-amber-700">No opt-in recorded — automated messages are blocked</span>}</p>
            {can(profile, "consent.manage") && <ConsentForm customerId={c.id} optedIn={!!c.wa_opt_in_at} optedOut={!!c.wa_opted_out_at} />}
            {!!consent?.length && <ul className="mt-3 space-y-1 text-xs text-slate-600">{consent.map((e) => (
              <li key={e.id}><b className={e.status === "opt_in" ? "text-brand-700" : "text-red-700"}>{e.status === "opt_in" ? "Opt-in" : "Opt-out"}</b> · {e.source}{e.note ? ` — ${e.note}` : ""} · {e.actor_id ? uName.get(e.actor_id) ?? "user" : "customer"} · {fmtDateTime(e.created_at)}</li>))}</ul>}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Notes</h2>
            {!notes?.length ? <p className="text-sm text-slate-500">No notes.</p> : <ul className="space-y-2 text-sm">{notes.map((n) => (
              <li key={n.id}><div className="whitespace-pre-wrap">{n.body}</div><div className="text-xs text-slate-400">{n.author_id ? uName.get(n.author_id) : ""} · {fmtDateTime(n.created_at)}{n.conversation_id ? " · chat note" : ""}</div></li>))}</ul>}
          </section>
        </div>
      </div>
    </>
  );
}
