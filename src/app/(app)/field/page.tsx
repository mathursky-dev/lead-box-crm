import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { istDate, istMidnight } from "@/lib/dates";
import { FieldTabs } from "./tabs";
import { FieldApp, type FieldServerState } from "./field-app";

export const metadata = { title: "Field app" };
// Always fresh: the phone keeps its own copy for offline use (service worker + IndexedDB).
export const dynamic = "force-dynamic";

export default async function FieldPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const nowMs = new Date().getTime();
  const t0 = istMidnight(istDate()).toISOString();
  const [att, visits, openVisit, exp, pending] = await Promise.all([
    sb.from("lb_attendance").select("client_id,check_in_at,check_out_at").eq("user_id", profile.id).eq("company_id", profile.company_id)
      .gte("check_in_at", new Date(nowMs - 36 * 3600e3).toISOString()).order("check_in_at", { ascending: false }).limit(20),
    sb.from("lb_field_visits").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("company_id", profile.company_id).gte("started_at", t0),
    sb.from("lb_field_visits").select("client_id,started_at,customer_name,lead_id,lead:lb_leads(lead_no,customer:lb_customers(name,phone_e164))")
      .eq("user_id", profile.id).eq("company_id", profile.company_id).is("ended_at", null)
      .gte("started_at", new Date(nowMs - 7 * 86400e3).toISOString()).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("lb_expenses").select("id,expense_no,expense_date,category,amount,status,review_note").eq("user_id", profile.id).eq("company_id", profile.company_id)
      .order("created_at", { ascending: false }).limit(6),
    isManager(profile)
      ? sb.from("lb_expenses").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id).eq("status", "pending").neq("user_id", profile.id)
      : Promise.resolve({ count: 0 }),
  ]);
  if (att.error && /lb_attendance|schema cache/i.test(att.error.message)) {
    return <><FieldTabs /><ErrorBox message="Field force is not set up yet: the database update for Attendance, Visits and Expenses has to be run once (Supabase SQL)." /></>;
  }
  const rows = (att.data ?? []) as { client_id: string; check_in_at: string; check_out_at: string | null }[];
  const open = rows.find((r) => !r.check_out_at) ?? null;
  const today = rows.filter((r) => r.check_in_at >= t0);
  const workedMin = today.reduce((n, r) => n + ((r.check_out_at ? new Date(r.check_out_at).getTime() : nowMs) - new Date(r.check_in_at).getTime()) / 60000, 0);
  const ov = openVisit.data as unknown as { client_id: string; started_at: string; customer_name: string; lead_id: string | null;
    lead: { lead_no: number; customer: { name: string | null; phone_e164: string } | null } | null } | null;

  const state: FieldServerState = {
    renderedAt: nowMs,
    session: open ? { client_id: open.client_id, at: open.check_in_at } : null,
    firstIn: today.length ? today[today.length - 1].check_in_at : null,
    workedMin: Math.round(workedMin),
    visit: ov ? { client_id: ov.client_id, at: ov.started_at, lead_id: ov.lead_id,
      name: ov.lead ? `${ov.lead.customer?.name || ov.lead.customer?.phone_e164 || ""} · LB-${ov.lead.lead_no}` : ov.customer_name || "Customer" } : null,
    visitsToday: visits.count ?? 0,
    expenses: (exp.data ?? []).map((e) => ({ id: e.id as string, no: e.expense_no as number, date: e.expense_date as string, category: e.category as string,
      amount: Number(e.amount), status: e.status as string, note: (e.review_note as string) ?? "" })),
    pendingApprovals: pending.count ?? 0,
  };
  return (
    <>
      <FieldTabs />
      <FieldApp userId={profile.id} name={profile.full_name} server={state} openExpense={sp.expense === "1"} />
    </>
  );
}
