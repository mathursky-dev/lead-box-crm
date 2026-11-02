import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { nowMs } from "@/lib/care";
import { OPEN_TICKET, slaLabel, ticketPriority, ticketStatus } from "@/lib/retention";
import { retentionSettings, RET_NOT_READY, retNotReady } from "@/lib/retention-server";
import { EditTicketButton, TicketReply, TicketStatus } from "../../retention-ui";

export const metadata = { title: "Ticket" };

const KIND: Record<string, { label: string; cls: string }> = {
  reply: { label: "Reply", cls: "border-brand-200 bg-brand-50" },
  internal: { label: "Internal note", cls: "border-amber-200 bg-amber-50" },
  customer: { label: "Customer", cls: "border-sky-200 bg-sky-50" },
  event: { label: "", cls: "border-transparent bg-transparent" },
};

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: t, error } = await sb.from("lb_tickets").select("*,customer:lb_customers(id,name,phone_e164),lead:lb_leads(id,lead_no)").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (error) return <ErrorBox message={retNotReady(error.message) ? RET_NOT_READY : error.message} />;
  if (!t) notFound();
  const [{ data: comments }, refs, s] = await Promise.all([
    sb.from("lb_ticket_comments").select("id,kind,author_id,body,created_at").eq("ticket_id", id).order("created_at").limit(500),
    loadRefs(), retentionSettings(sb, profile.company_id),
  ]);
  const c = t.customer as unknown as { id: string; name: string | null; phone_e164: string } | null;
  const lead = t.lead as unknown as { id: string; lead_no: number } | null;
  const userName = new Map(refs.users.map((u) => [u.id, u.full_name]));
  const users = refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }));
  const st = ticketStatus(t.status), pr = ticketPriority(t.priority);
  const now = nowMs();
  const isOpen = OPEN_TICKET.includes(t.status);
  const resp = isOpen && !t.first_response_at ? slaLabel(t.response_due_at, now) : null;
  const fix = isOpen ? slaLabel(t.resolve_due_at, now) : null;
  return (
    <div className="space-y-4">
      <Link href="/care/tickets" className="text-sm text-brand-700 hover:underline">← All tickets</Link>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500">TK-{t.ticket_no} {t.category ? `· ${t.category}` : ""}</p>
                <h1 className="text-lg font-semibold text-navy-900">{t.subject}</h1>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span>
                  <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${pr.cls}`}>{pr.label}</span>
                  {(t.response_breached || t.resolve_breached) && <span className="rounded bg-red-100 px-1.5 text-[10px] font-bold uppercase text-red-700">SLA breached</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <EditTicketButton edit={{ id: t.id, subject: t.subject, description: t.description, category: t.category, priority: t.priority, assigned_to: t.assigned_to }}
                  categories={s?.ticket_categories ?? []} users={users} />
                <TicketStatus id={t.id} status={t.status} />
              </div>
            </div>
            {t.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{t.description}</p>}
            {t.resolution && <p className="mt-3 rounded-lg bg-green-50 p-2 text-sm text-green-800"><b>Resolution:</b> {t.resolution}</p>}
          </section>
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-navy-900">Conversation</h2>
            <ul className="space-y-2">
              {(comments ?? []).map((m) => {
                const k = KIND[m.kind as string] ?? KIND.reply;
                if (m.kind === "event") return (
                  <li key={m.id as string} className="whitespace-pre-line px-1 text-xs text-slate-500">
                    • {m.body as string} <span className="text-slate-400">· {m.author_id ? userName.get(m.author_id as string) ?? "" : "system"} · {fmtDateTime(m.created_at as string)}</span>
                  </li>
                );
                return (
                  <li key={m.id as string} className={`rounded-lg border p-2.5 ${k.cls}`}>
                    <div className="mb-1 text-xs text-slate-500"><b className="text-navy-900">{m.kind === "customer" ? c?.name || "Customer" : userName.get(m.author_id as string) ?? "Staff"}</b> · {k.label} · {fmtDateTime(m.created_at as string)}</div>
                    <p className="whitespace-pre-line text-sm text-slate-800">{m.body as string}</p>
                  </li>
                );
              })}
            </ul>
            {t.status !== "closed" && <div className="mt-4"><TicketReply id={t.id} canSend={can(profile, "chats.send")} hasLead={Boolean(lead)} /></div>}
          </section>
        </div>
        <div className="space-y-4">
          <section className="card space-y-2 p-4 text-sm">
            <h2 className="text-sm font-semibold text-navy-900">Details</h2>
            <p>Customer: <b>{c?.name || "—"}</b> <span className="text-slate-500">{c?.phone_e164}</span></p>
            {lead && <p>Lead: <Link href={`/leads/${lead.id}`} className="text-brand-700 hover:underline">LB-{lead.lead_no}</Link></p>}
            <p>Assigned: <b>{t.assigned_to ? userName.get(t.assigned_to) ?? "—" : "Nobody"}</b></p>
            <p>Opened: {fmtDateTime(t.created_at)} {t.channel !== "staff" ? `(${t.channel === "portal" ? "customer portal" : "WhatsApp complaint"})` : ""}</p>
            <p>First response: {t.first_response_at ? fmtDateTime(t.first_response_at) : resp ? <span className={resp.late ? "font-semibold text-red-600" : ""}>{resp.text}</span> : "—"}</p>
            <p>Resolve by: {fmtDateTime(t.resolve_due_at)} {fix && <span className={fix.late ? "font-semibold text-red-600" : "text-slate-500"}>({fix.text})</span>}</p>
            {t.resolved_at && <p>Resolved: {fmtDateTime(t.resolved_at)}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
