import { requireProfile, isAdmin, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { istDate, istMidnight } from "@/lib/dates";
import { OPEN_STATUSES, TASK_PAGE_SIZES, TASK_SORT, TASK_STATUSES } from "@/lib/tasks";
import type { LeadTableLayout } from "@/lib/actions/prefs";
import { ChatPopupHost } from "../leads/chat-popup-host";
import { TasksView, type TaskRow } from "./tasks-view";

export const metadata = { title: "Tasks" };

type SP = Record<string, string | undefined>;
const SEL = "id,task_no,title,description,status,priority,due_at,completed_at,created_at,updated_at,assigned_by,assigned_to,lead_id," +
  "assigner:lb_profiles!lb_tasks_assigned_by_fkey(full_name),assignee:lb_profiles!lb_tasks_assigned_to_fkey(full_name)," +
  "lead:lb_leads(id,lead_no,customer:lb_customers(name,phone_e164))";

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const refs = await loadRefs();
  const sb = await createClient();
  const per = TASK_PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 20;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const scope = ["to_me", "by_me"].includes(sp.scope ?? "") ? sp.scope! : "all";
  const sortKey = TASK_SORT[sp.sort ?? ""] ? sp.sort! : "created";
  const asc = sp.dir ? sp.dir === "asc" : sortKey === "due" || sortKey === "task";
  const term = String(sp.q ?? "").replace(/[%_,()\\*]/g, " ").trim().slice(0, 80);
  const now = new Date().toISOString();
  const t0 = istMidnight(istDate()).toISOString();
  const t1 = new Date(istMidnight(istDate()).getTime() + 86400000).toISOString();
  const open = `(${OPEN_STATUSES.join(",")})`;

  // Shared filters (everything except the due filter) so the overdue / today counts match the list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (q: any) => {
    q = q.eq("company_id", profile.company_id);
    if (scope === "to_me") q = q.eq("assigned_to", profile.id);
    if (scope === "by_me") q = q.eq("assigned_by", profile.id);
    if (sp.to && /^[0-9a-f-]{36}$/.test(sp.to)) q = q.eq("assigned_to", sp.to);
    if (sp.status && TASK_STATUSES.some((s) => s.value === sp.status)) q = q.eq("status", sp.status);
    if (sp.priority && /^[1-5]$/.test(sp.priority)) q = q.eq("priority", Number(sp.priority));
    if (sp.lead && /^[0-9a-f-]{36}$/.test(sp.lead)) q = q.eq("lead_id", sp.lead);
    if (term) q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    return q;
  };

  let list = base(sb.from("lb_tasks").select(SEL, { count: "exact" }));
  switch (sp.due) {
    case "open": list = list.filter("status", "in", open); break;
    case "overdue": list = list.filter("status", "in", open).lt("due_at", now); break;
    case "today": list = list.filter("status", "in", open).gte("due_at", t0).lt("due_at", t1); break;
    case "upcoming": list = list.filter("status", "in", open).gte("due_at", t1); break;
    case "nodate": list = list.filter("status", "in", open).is("due_at", null); break;
    case "completed": list = list.eq("status", "completed"); break;
  }
  list = list.order(TASK_SORT[sortKey], { ascending: asc, nullsFirst: false }).order("created_at", { ascending: false })
    .range((page - 1) * per, page * per - 1);

  const head = () => sb.from("lb_tasks").select("id", { count: "exact", head: true });
  const [res, overdue, today, mine, pref, linked, opened] = await Promise.all([
    list,
    base(head()).filter("status", "in", open).lt("due_at", now),
    base(head()).filter("status", "in", open).gte("due_at", t0).lt("due_at", t1),
    head().eq("company_id", profile.company_id).eq("assigned_to", profile.id).filter("status", "in", open),
    sb.from("lb_user_prefs").select("value").eq("user_id", profile.id).eq("key", "tasks.table").maybeSingle(),
    // "Add task" from a lead page pre-fills that lead.
    sp.new && sp.lead && /^[0-9a-f-]{36}$/.test(sp.lead)
      ? sb.from("lb_leads").select("id,lead_no,customer:lb_customers(name,phone_e164)").eq("id", sp.lead).eq("company_id", profile.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // A notification link (/tasks?task=…) opens that task even when it is not on this page.
    sp.task && /^[0-9a-f-]{36}$/.test(sp.task)
      ? sb.from("lb_tasks").select(SEL).eq("id", sp.task).eq("company_id", profile.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const missingTable = res.error && /lb_tasks|schema cache/i.test(res.error.message);
  const ld = linked.data as { id: string; lead_no: number; customer: { name: string | null; phone_e164: string } | null } | null;

  return (
    <>
      {res.error ? (
        <ErrorBox message={missingTable ? "Tasks are not set up yet: the database update for Tasks has to be run once (Supabase SQL)." : res.error.message} />
      ) : (
        <TasksView
          rows={(res.data ?? []) as unknown as TaskRow[]} total={res.count ?? 0} page={page} per={per}
          sp={Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>}
          scope={scope} sortKey={sortKey} sortDir={asc ? "asc" : "desc"}
          counts={{ overdue: overdue.count ?? 0, today: today.count ?? 0, mine: mine.count ?? 0 }}
          users={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))}
          me={profile.id} admin={isAdmin(profile)} manager={isManager(profile)}
          saved={(pref.data?.value as LeadTableLayout | undefined) ?? null}
          openNew={sp.new === "1"}
          newLead={ld ? { id: ld.id, lead_no: ld.lead_no, name: ld.customer?.name ?? null, phone: ld.customer?.phone_e164 ?? "" } : null}
          openTask={(opened.data as unknown as TaskRow | null) ?? null}
        />
      )}
      <ChatPopupHost />
    </>
  );
}
