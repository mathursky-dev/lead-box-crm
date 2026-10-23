import Link from "next/link";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty, ErrorBox, Pager } from "@/components/static";
import { istDate, istMidnight, fmtDateTime } from "@/lib/dates";
import { FollowupActions } from "./actions";

export const metadata = { title: "Follow-ups" };
const LIMIT = 50;
const TABS = [["today", "Due today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["done", "Completed"]] as const;

export default async function FollowupsPage({ searchParams }: { searchParams: Promise<{ tab?: string; mine?: string; offset?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "today";
  const offset = Math.max(0, Number(sp.offset) || 0);
  const { profile } = await requireProfile();
  const mine = !isManager(profile) || sp.mine !== "0";
  const t0 = istMidnight(istDate()).toISOString();
  const t1 = new Date(istMidnight(istDate()).getTime() + 86400000).toISOString();
  const sb = await createClient();
  let q = sb.from("lb_followups")
    .select("id,due_at,note,status,completed_at,assigned_to,lead:lb_leads(id,lead_no,customer:lb_customers(name,phone_e164)),owner:lb_profiles!lb_followups_assigned_to_fkey(full_name)", { count: "exact" });
  if (mine) q = q.eq("assigned_to", profile.id);
  if (tab === "today") q = q.eq("status", "pending").gte("due_at", t0).lt("due_at", t1).order("due_at");
  else if (tab === "overdue") q = q.eq("status", "pending").lt("due_at", t0).order("due_at");
  else if (tab === "upcoming") q = q.eq("status", "pending").gte("due_at", t1).order("due_at");
  else q = q.neq("status", "pending").order("completed_at", { ascending: false });
  const { data, count, error } = await q.range(offset, offset + LIMIT - 1);

  return (
    <>
      <PageHeader title="Follow-ups" sub="Times shown in IST. Reminders arrive as in-app notifications 15 minutes before due." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map(([t, l]) => (
          <Link key={t} href={`/followups?tab=${t}${sp.mine ? `&mine=${sp.mine}` : ""}`} className={tab === t ? "btn-navy btn-sm" : "btn-ghost btn-sm"}>{l}</Link>
        ))}
        {isManager(profile) && (
          <Link href={`/followups?tab=${tab}&mine=${mine ? "0" : "1"}`} className="ml-auto text-sm text-brand-700 hover:underline">{mine ? "Show my team's" : "Show only mine"}</Link>
        )}
      </div>
      {error ? <ErrorBox message={error.message} /> : !data?.length ? <Empty title="Nothing here">No follow-ups in this list.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="border-b bg-slate-50"><tr><th className="th">Due</th><th className="th">Lead</th><th className="th">Note</th><th className="th">Owner</th><th className="th"></th></tr></thead>
            <tbody className="divide-y">
              {data.map((f) => {
                const lead = f.lead as unknown as { id: string; lead_no: number; customer: { name: string | null; phone_e164: string } };
                return (
                  <tr key={f.id}>
                    <td className={`td whitespace-nowrap ${f.status === "pending" && f.due_at < new Date().toISOString() ? "font-medium text-red-600" : ""}`}>{fmtDateTime(f.due_at)}</td>
                    <td className="td"><Link className="text-brand-700 hover:underline" href={`/leads/${lead.id}`}>LB-{lead.lead_no}</Link> <span className="text-sm">{lead.customer.name ?? lead.customer.phone_e164}</span></td>
                    <td className="td text-sm text-slate-600">{f.note}</td>
                    <td className="td text-sm">{(f.owner as unknown as { full_name: string } | null)?.full_name ?? "—"}</td>
                    <td className="td text-right">{f.status === "pending" ? <FollowupActions id={f.id} /> : <span className="text-xs capitalize text-slate-500">{f.status} {fmtDateTime(f.completed_at)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={count ?? 0} limit={LIMIT} offset={offset} params={{ tab, mine: sp.mine }} basePath="/followups" />
    </>
  );
}
