import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { Notice } from "@/components/kit";
import { AllocationBoard, CityBoard, type AllocRow, type MemberRow, type UserLite } from "./allocation";
import { RoutingBoard, ReplySlaCard, type RuleRow, type SlaLogRow } from "./routing";

export const metadata = { title: "Lead allocation" };

const istNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, dow: String(p.weekday).toLowerCase().slice(0, 3), time: `${p.hour}:${p.minute}` };
};

type Prof = { id: string; full_name: string; role: string; is_active: boolean; accepts_auto_allocation: boolean; allocation_limit: number | null; availability: string; working_hours: Record<string, [string, string]> | null };

export default async function AllocationPage() {
  const { profile: me, company } = await requireAdmin();
  const cid = me.company_id;
  const sb = await createClient();
  const [{ data: allocs }, { data: members }, { data: sources }, { data: profs }, { data: counts }, { data: waiting },
    { data: rules }, { data: ruleMembers }, { data: products }, { data: sla }, { data: slaLog }] = await Promise.all([
    sb.from("lb_alloc_sources").select("id,source_id,is_active,created_at,name,cities").eq("company_id", cid).order("created_at"),
    sb.from("lb_alloc_members").select("id,alloc_id,user_id,ratio,max_per_day,is_active,day,day_count,total_count,created_at").eq("company_id", cid).order("created_at"),
    sb.from("lb_sources").select("id,name,is_active").eq("company_id", cid).order("name"),
    sb.from("lb_profiles").select("id,full_name,role,is_active,accepts_auto_allocation,allocation_limit,availability,working_hours").eq("company_id", cid).order("full_name"),
    sb.rpc("lb_open_lead_counts"),
    sb.from("lb_leads").select("source_id").eq("company_id", cid).is("owner_id", null).not("status_category", "in", "(won,lost,invalid)").limit(10000),
    sb.from("lb_route_rules").select("id,name,priority,is_active,product_ids,languages,source_ids,pick_mode").eq("company_id", cid).order("priority").order("created_at"),
    sb.from("lb_route_members").select("id,rule_id,user_id,ratio,max_per_day,is_active,day,day_count,total_count").eq("company_id", cid).order("created_at"),
    sb.from("lb_products").select("id,name").eq("company_id", cid).eq("is_active", true).order("name"),
    sb.from("lb_reply_sla").select("enabled,minutes,max_reassign,notify_managers").eq("company_id", cid).maybeSingle(),
    sb.from("lb_reply_sla_log").select("id,created_at,lead_id,action,from_user_id,to_user_id,waited_min,lead:lb_leads(lead_no)").eq("company_id", cid).order("created_at", { ascending: false }).limit(20),
  ]);

  const now = istNow();
  const open = new Map(((counts ?? []) as { owner_id: string; open_leads: number }[]).map((c) => [c.owner_id, Number(c.open_leads)]));
  const people = (profs ?? []) as Prof[];
  const users: UserLite[] = people.map((u) => {
    const load = open.get(u.id) ?? 0;
    const wh = u.working_hours?.[now.dow];
    const block = !u.is_active ? "User is deactivated"
      : !u.accepts_auto_allocation ? "Auto-allocation is off for this user (Users page)"
      : u.availability !== "available" ? `User is ${u.availability}`
      : u.working_hours && (!wh || now.time < wh[0] || now.time >= wh[1]) ? "Outside working hours now"
      : u.allocation_limit != null && load >= u.allocation_limit ? `Open-lead limit reached (${load}/${u.allocation_limit})`
      : null;
    return { id: u.id, name: u.full_name, active: u.is_active, open: load, block };
  });

  const srcName = new Map((sources ?? []).map((s) => [s.id, s.name]));
  const srcAllocs = (allocs ?? []).filter((a) => !a.cities);
  const listed = new Set(srcAllocs.map((a) => a.source_id).filter(Boolean) as string[]);
  const wait = new Map<string, number>();
  for (const l of (waiting ?? []) as { source_id: string | null }[]) {
    const key = l.source_id && listed.has(l.source_id) ? l.source_id : "others";
    wait.set(key, (wait.get(key) ?? 0) + 1);
  }

  const rows: AllocRow[] = srcAllocs.map((a) => ({
    id: a.id, sourceId: a.source_id, name: a.source_id ? srcName.get(a.source_id) ?? "Deleted source" : "Others", active: a.is_active,
    waiting: wait.get(a.source_id ?? "others") ?? 0, cities: null,
  })).sort((a, b) => Number(a.sourceId === null) - Number(b.sourceId === null) || a.name.localeCompare(b.name));
  const cityRows: AllocRow[] = (allocs ?? []).filter((a) => a.cities).map((a) => ({
    id: a.id, sourceId: a.source_id, name: a.name || (a.cities as string[]).join(", "), active: a.is_active, waiting: 0, cities: a.cities as string[],
    sourceName: a.source_id ? srcName.get(a.source_id) ?? "Deleted source" : null,
  }));
  const memberRows: MemberRow[] = ((members ?? []) as { id: string; alloc_id: string; user_id: string; ratio: number; max_per_day: number | null; is_active: boolean; day: string | null; day_count: number; total_count: number }[])
    .map((m) => ({ id: m.id, allocId: m.alloc_id, userId: m.user_id, ratio: m.ratio, maxPerDay: m.max_per_day, active: m.is_active, today: m.day === now.day ? m.day_count : 0, total: m.total_count }));
  const addable = [
    ...(sources ?? []).filter((s) => !listed.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
    ...(srcAllocs.some((a) => a.source_id === null) ? [] : [{ id: "others", name: "Others (all remaining sources)" }]),
  ];

  const ruleRows: RuleRow[] = ((rules ?? []) as { id: string; name: string; priority: number; is_active: boolean; product_ids: string[] | null; languages: string[] | null; source_ids: string[] | null; pick_mode: RuleRow["mode"] }[])
    .map((r) => ({ id: r.id, name: r.name, priority: r.priority, active: r.is_active, productIds: r.product_ids ?? [], languages: r.languages ?? [], sourceIds: r.source_ids ?? [], mode: r.pick_mode }));
  const ruleMemberRows: MemberRow[] = ((ruleMembers ?? []) as { id: string; rule_id: string; user_id: string; ratio: number; max_per_day: number | null; is_active: boolean; day: string | null; day_count: number; total_count: number }[])
    .map((m) => ({ id: m.id, allocId: m.rule_id, userId: m.user_id, ratio: m.ratio, maxPerDay: m.max_per_day, active: m.is_active, today: m.day === now.day ? m.day_count : 0, total: m.total_count }));
  const nameOf = new Map(people.map((u) => [u.id, u.full_name]));
  const logRows: SlaLogRow[] = ((slaLog ?? []) as unknown as { id: string; created_at: string; lead_id: string; action: SlaLogRow["action"]; from_user_id: string | null; to_user_id: string | null; waited_min: number | null; lead: { lead_no: number } | null }[])
    .map((g) => ({ id: g.id, at: g.created_at, leadId: g.lead_id, leadNo: g.lead?.lead_no ?? null, action: g.action,
      from: g.from_user_id ? nameOf.get(g.from_user_id) ?? null : null, to: g.to_user_id ? nameOf.get(g.to_user_id) ?? null : null, waited: g.waited_min }));
  const srcOpts = (sources ?? []).map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <PageHeader icon="refresh" tone="violet" title="Lead allocation"
        sub="Routing rules (product, language, source) are checked first, then city-wise lists, then the source lists. Each list gives leads to its users by ratio or workload, up to each user's max per day. The first-reply SLA at the bottom moves late leads to someone else." />
      {!company?.auto_allocate && (
        <Notice>Auto-allocation is switched off for the company, so new leads stay unassigned. Turn it on in <Link href="/admin/settings" className="font-semibold underline">Settings</Link>.</Notice>
      )}
      <RoutingBoard rules={ruleRows} members={ruleMemberRows} users={users} products={(products ?? []).map((p) => ({ id: p.id, name: p.name }))} sources={srcOpts} />
      <AllocationBoard rows={rows} members={memberRows} users={users} addable={addable} />
      <CityBoard rows={cityRows} members={memberRows} users={users} sources={srcOpts} />
      <div className="mt-4" />
      <ReplySlaCard autoAllocate={!!company?.auto_allocate} log={logRows}
        sla={{ enabled: !!sla?.enabled, minutes: sla?.minutes ?? 15, maxReassign: sla?.max_reassign ?? 2, notify: sla?.notify_managers ?? true }} />
    </>
  );
}
