import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { Notice } from "@/components/kit";
import { AllocationBoard, type AllocRow, type MemberRow, type UserLite } from "./allocation";

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
  const [{ data: allocs }, { data: members }, { data: sources }, { data: profs }, { data: counts }, { data: waiting }] = await Promise.all([
    sb.from("lb_alloc_sources").select("id,source_id,is_active,created_at").eq("company_id", cid).order("created_at"),
    sb.from("lb_alloc_members").select("id,alloc_id,user_id,ratio,max_per_day,is_active,day,day_count,total_count,created_at").eq("company_id", cid).order("created_at"),
    sb.from("lb_sources").select("id,name,is_active").eq("company_id", cid).order("name"),
    sb.from("lb_profiles").select("id,full_name,role,is_active,accepts_auto_allocation,allocation_limit,availability,working_hours").eq("company_id", cid).order("full_name"),
    sb.rpc("lb_open_lead_counts"),
    sb.from("lb_leads").select("source_id").eq("company_id", cid).is("owner_id", null).not("status_category", "in", "(won,lost,invalid)").limit(10000),
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
  const listed = new Set((allocs ?? []).map((a) => a.source_id).filter(Boolean) as string[]);
  const wait = new Map<string, number>();
  for (const l of (waiting ?? []) as { source_id: string | null }[]) {
    const key = l.source_id && listed.has(l.source_id) ? l.source_id : "others";
    wait.set(key, (wait.get(key) ?? 0) + 1);
  }

  const rows: AllocRow[] = (allocs ?? []).map((a) => ({
    id: a.id, sourceId: a.source_id, name: a.source_id ? srcName.get(a.source_id) ?? "Deleted source" : "Others", active: a.is_active,
    waiting: wait.get(a.source_id ?? "others") ?? 0,
  })).sort((a, b) => Number(a.sourceId === null) - Number(b.sourceId === null) || a.name.localeCompare(b.name));
  const memberRows: MemberRow[] = ((members ?? []) as { id: string; alloc_id: string; user_id: string; ratio: number; max_per_day: number | null; is_active: boolean; day: string | null; day_count: number; total_count: number }[])
    .map((m) => ({ id: m.id, allocId: m.alloc_id, userId: m.user_id, ratio: m.ratio, maxPerDay: m.max_per_day, active: m.is_active, today: m.day === now.day ? m.day_count : 0, total: m.total_count }));
  const addable = [
    ...(sources ?? []).filter((s) => !listed.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
    ...((allocs ?? []).some((a) => a.source_id === null) ? [] : [{ id: "others", name: "Others (all remaining sources)" }]),
  ];

  return (
    <>
      <PageHeader icon="refresh" tone="violet" title="Lead allocation"
        sub="Pick the users for each lead source and how leads are split between them. New leads of that source go to its users by ratio, up to each user's max per day." />
      {!company?.auto_allocate && (
        <Notice>Auto-allocation is switched off for the company, so new leads stay unassigned. Turn it on in <Link href="/admin/settings" className="font-semibold underline">Settings</Link>.</Notice>
      )}
      <AllocationBoard rows={rows} members={memberRows} users={users} addable={addable} />
    </>
  );
}
