import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { Kpi, PillTabs, Table } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { nowMs } from "@/lib/care";
import { OPEN_TICKET, slaLabel, ticketPriority, ticketStatus } from "@/lib/retention";
import { retentionSettings, RET_NOT_READY, retNotReady } from "@/lib/retention-server";
import { NewTicketButton, TicketStatus } from "../retention-ui";

export const metadata = { title: "Service tickets" };

type SP = Record<string, string | undefined>;
const VIEWS = [
  { key: "open", label: "Open" }, { key: "mine", label: "Assigned to me" }, { key: "late", label: "SLA breached" },
  { key: "resolved", label: "Resolved" }, { key: "all", label: "All" },
];
type Cust = { name: string | null; phone_e164: string } | null;

export default async function TicketsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const cid = profile.company_id;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "open";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const now = nowMs();
  const since = new Date(now - 30 * 86400000).toISOString();

  let list = sb.from("lb_tickets").select("id,ticket_no,subject,category,priority,status,channel,assigned_to,response_due_at,resolve_due_at,first_response_at,resolved_at,response_breached,resolve_breached,created_at,lead_id,customer:lb_customers(name,phone_e164)").eq("company_id", cid);
  if (view === "open") list = list.in("status", OPEN_TICKET);
  else if (view === "mine") list = list.in("status", OPEN_TICKET).eq("assigned_to", profile.id);
  else if (view === "late") list = list.or("response_breached.eq.true,resolve_breached.eq.true").in("status", OPEN_TICKET);
  else if (view === "resolved") list = list.in("status", ["resolved", "closed"]);
  if (/^(tk-?)?\d+$/i.test(q)) list = list.eq("ticket_no", Number(q.replace(/\D/g, "")));
  else if (q) list = list.ilike("subject", `%${q.replace(/[%_,()]/g, " ")}%`);
  const [{ data, error }, { data: stats }, refs, s] = await Promise.all([
    list.order("created_at", { ascending: false }).limit(300),
    sb.from("lb_tickets").select("status,priority,created_at,resolved_at,response_breached,resolve_breached").eq("company_id", cid).or(`status.in.(open,in_progress,waiting),created_at.gte.${since}`).limit(10000),
    loadRefs(),
    retentionSettings(sb, cid),
  ]);
  if (error) return <ErrorBox message={retNotReady(error.message) ? RET_NOT_READY : error.message} />;
  const all = stats ?? [];
  const open = all.filter((t) => OPEN_TICKET.includes(t.status as string));
  const late = open.filter((t) => t.response_breached || t.resolve_breached);
  const done = all.filter((t) => t.resolved_at && (t.resolved_at as string) >= since);
  const avgH = done.length ? Math.round(done.reduce((n, t) => n + (Date.parse(t.resolved_at as string) - Date.parse(t.created_at as string)), 0) / done.length / 3600000) : null;
  const onTime = done.length ? Math.round((done.filter((t) => !t.resolve_breached).length / done.length) * 100) : null;
  const users = refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }));
  const userName = new Map(refs.users.map((u) => [u.id, u.full_name]));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Open tickets" value={open.length} sub={`${open.filter((t) => t.priority === "urgent" || t.priority === "high").length} high / urgent`} icon="help" tone="amber" href="/care/tickets?view=open" />
        <Kpi label="SLA breached" value={late.length} icon="alert" tone={late.length ? "red" : "green"} href="/care/tickets?view=late" />
        <Kpi label="Resolved (30 days)" value={done.length} sub={onTime == null ? undefined : `${onTime}% on time`} icon="check" tone="green" />
        <Kpi label="Avg. resolution" value={avgH == null ? "—" : avgH >= 48 ? `${Math.round(avgH / 24)} days` : `${avgH} h`} icon="clock" tone="blue" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PillTabs label="Ticket views" tabs={VIEWS.map((v) => ({ href: `/care/tickets?view=${v.key}`, label: v.label, active: v.key === view }))} />
        <form className="ml-auto flex gap-2" action="/care/tickets">
          <input type="hidden" name="view" value={view} />
          <input className="input !w-48 !py-1.5" name="q" defaultValue={q} placeholder="TK-12 or subject" aria-label="Search tickets" />
        </form>
        <NewTicketButton target={{}} categories={s?.ticket_categories ?? []} users={users} />
      </div>
      <div className="card overflow-hidden">
        <Table head={["Ticket", "Customer", "Priority", "Status", "SLA", "Assigned", "Opened"]} empty={data?.length ? undefined : view === "open" ? "No open tickets 🎉" : "Nothing here."}>
          {(data ?? []).map((t) => {
            const c = t.customer as unknown as Cust;
            const st = ticketStatus(t.status as string), pr = ticketPriority(t.priority as string);
            const isOpen = OPEN_TICKET.includes(t.status as string);
            const due = isOpen ? (!t.first_response_at && t.status === "open" ? (t.response_due_at as string | null) : (t.resolve_due_at as string | null)) : null;
            const sla = slaLabel(due, now);
            return (
              <tr key={t.id as string}>
                <td className="td max-w-xs">
                  <Link href={`/care/tickets/${t.id}`} className="font-medium text-brand-700 hover:underline">TK-{t.ticket_no as number}</Link>
                  <div className="truncate text-sm text-navy-900">{t.subject as string}</div>
                  <div className="text-xs text-slate-500">{[t.category, t.channel === "portal" ? "from portal" : t.channel === "complaint" ? "from WhatsApp complaint" : null].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="td">{c?.name || "—"}<div className="text-xs text-slate-500">{c?.phone_e164}</div></td>
                <td className="td"><span className={`rounded px-1.5 text-[10px] font-bold uppercase ${pr.cls}`}>{pr.label}</span></td>
                <td className="td">{isOpen || t.status === "resolved" ? <TicketStatus id={t.id as string} status={t.status as string} /> : <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span>}</td>
                <td className="td whitespace-nowrap text-xs">
                  {sla ? <span className={sla.late ? "font-semibold text-red-600" : "text-slate-600"}>{!t.first_response_at && t.status === "open" ? "Reply: " : "Fix: "}{sla.text}</span>
                    : isOpen ? "—" : t.resolve_breached ? <span className="text-red-600">Late</span> : <span className="text-brand-700">On time</span>}
                </td>
                <td className="td text-sm">{t.assigned_to ? userName.get(t.assigned_to as string) ?? "—" : <span className="text-amber-700">Unassigned</span>}</td>
                <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDateTime(t.created_at as string)}</td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
