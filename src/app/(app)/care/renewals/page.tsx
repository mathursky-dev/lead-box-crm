import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { Kpi, PillTabs, Table } from "@/components/kit";
import { money } from "@/lib/dates";
import { nowMs } from "@/lib/care";
import { daysUntil, fmtYmd, renewalKind, RENEWAL_STATUSES } from "@/lib/retention";
import { RET_NOT_READY, retNotReady } from "@/lib/retention-server";
import { EditRenewalButton, NewRenewalButton, RenewalActions } from "../retention-ui";

export const metadata = { title: "Renewals / AMC" };

type SP = Record<string, string | undefined>;
const VIEWS = [
  { key: "due", label: "Due in 30 days" }, { key: "overdue", label: "Overdue" }, { key: "active", label: "All active" },
  { key: "lapsed", label: "Lapsed" }, { key: "all", label: "All" },
];
const ymd = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const cid = profile.company_id;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : sp.id ? "all" : "due";
  const now = nowMs(), today = ymd(now), in30 = ymd(now + 30 * 86400000);

  let q = sb.from("lb_renewals").select("id,renewal_no,title,kind,start_date,due_date,repeat_months,amount,status,assigned_to,notes,product_id,renewed_count,lead_id,customer:lb_customers(name,phone_e164)").eq("company_id", cid);
  if (sp.id && /^[0-9a-f-]{36}$/i.test(sp.id)) q = q.eq("id", sp.id);
  else if (view === "due") q = q.eq("status", "active").gte("due_date", today).lte("due_date", in30);
  else if (view === "overdue") q = q.eq("status", "active").lt("due_date", today);
  else if (view === "active") q = q.eq("status", "active");
  else if (view === "lapsed") q = q.eq("status", "lapsed");
  const [{ data, error }, { data: stats }, refs] = await Promise.all([
    q.order("due_date").limit(500),
    sb.from("lb_renewals").select("status,due_date,amount,last_renewed_at").eq("company_id", cid).limit(10000),
    loadRefs(),
  ]);
  if (error) return <ErrorBox message={retNotReady(error.message) ? RET_NOT_READY : error.message} />;
  const all = stats ?? [];
  const active = all.filter((r) => r.status === "active");
  const due30 = active.filter((r) => (r.due_date as string) >= today && (r.due_date as string) <= in30);
  const overdue = active.filter((r) => (r.due_date as string) < today);
  const renewedMonth = all.filter((r) => r.last_renewed_at && Date.parse(r.last_renewed_at as string) > now - 30 * 86400000).length;
  const users = refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }));
  const products = refs.products.filter((p) => p.is_active !== false).map((p) => ({ id: p.id, name: p.name }));
  const userName = new Map(refs.users.map((u) => [u.id, u.full_name]));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Due in 30 days" value={due30.length} sub={money(due30.reduce((n, r) => n + Number(r.amount ?? 0), 0))} icon="calendar" tone="amber" href="/care/renewals?view=due" />
        <Kpi label="Overdue" value={overdue.length} icon="alert" tone={overdue.length ? "red" : "green"} href="/care/renewals?view=overdue" />
        <Kpi label="Active contracts" value={active.length} sub={`${money(active.reduce((n, r) => n + Number(r.amount ?? 0), 0))} / cycle`} icon="refresh" tone="green" href="/care/renewals?view=active" />
        <Kpi label="Renewed (30 days)" value={renewedMonth} icon="check" tone="blue" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PillTabs label="Renewal views" tabs={VIEWS.map((v) => ({ href: `/care/renewals?view=${v.key}`, label: v.label, active: v.key === view && !sp.id }))} />
        <span className="ml-auto"><NewRenewalButton target={{}} users={users} products={products} /></span>
      </div>
      <div className="card overflow-hidden">
        <Table head={["Renewal", "Customer", "Due", "Amount", "Owner", "Status", ""]} empty={data?.length ? undefined : "Nothing here. Add AMCs / subscriptions from a lead or with “+ Add renewal”."}>
          {(data ?? []).map((r) => {
            const c = r.customer as unknown as { name: string | null; phone_e164: string } | null;
            const d = daysUntil(r.due_date as string, now);
            const st = RENEWAL_STATUSES[r.status as string] ?? RENEWAL_STATUSES.active;
            return (
              <tr key={r.id as string}>
                <td className="td max-w-xs">
                  <div className="font-medium text-navy-900">{r.title as string}</div>
                  <div className="text-xs text-slate-500">RN-{r.renewal_no as number} · {renewalKind(r.kind as string)}{r.repeat_months ? ` · every ${r.repeat_months} mo` : " · one time"}{Number(r.renewed_count) ? ` · renewed ${r.renewed_count}×` : ""}</div>
                </td>
                <td className="td">{r.lead_id ? <Link href={`/leads/${r.lead_id}`} className="text-brand-700 hover:underline">{c?.name || c?.phone_e164}</Link> : c?.name || "—"}<div className="text-xs text-slate-500">{c?.phone_e164}</div></td>
                <td className="td whitespace-nowrap">
                  {fmtYmd(r.due_date as string)}
                  {r.status === "active" && <div className={`text-xs ${d < 0 ? "font-semibold text-red-600" : d <= 7 ? "font-semibold text-amber-700" : "text-slate-500"}`}>{d < 0 ? `${-d} days overdue` : d === 0 ? "today" : `in ${d} days`}</div>}
                </td>
                <td className="td">{r.amount != null ? money(Number(r.amount)) : "—"}</td>
                <td className="td text-sm">{r.assigned_to ? userName.get(r.assigned_to as string) ?? "—" : "—"}</td>
                <td className="td"><span className={`rounded px-1.5 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span></td>
                <td className="td">
                  <div className="flex flex-wrap items-start gap-1.5">
                    <RenewalActions id={r.id as string} status={r.status as string} amount={r.amount != null ? Number(r.amount) : null} />
                    <EditRenewalButton users={users} products={products} edit={{
                      id: r.id as string, title: r.title as string, kind: r.kind as string, start_date: r.start_date as string | null, due_date: r.due_date as string,
                      repeat_months: r.repeat_months as number | null, amount: r.amount != null ? Number(r.amount) : null, assigned_to: r.assigned_to as string | null,
                      notes: r.notes as string | null, product_id: r.product_id as string | null,
                    }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
