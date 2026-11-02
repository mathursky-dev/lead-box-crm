import Link from "next/link";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Notice, Panel, Table } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { inr } from "@/lib/plans";
import { PlanReviewForm } from "./forms";

export const metadata = { title: "Plan payments" };

const STATUS: Record<string, [string, string]> = {
  pending: ["Pending", "bg-amber-50 text-amber-700"], approved: ["Approved", "bg-brand-50 text-brand-700"], rejected: ["Rejected", "bg-red-50 text-red-700"],
};
const PROVIDER: Record<string, string> = { razorpay: "Razorpay", upi: "UPI", manual: "Manual" };

/** Super Admin: subscription payments. UPI plan payments to verify, all payments received, plans ending soon. Access is checked in ../layout.tsx. */
export default async function PlatformBillingPage() {
  if (!hasServiceRole()) return <ErrorBox message="SUPABASE_SERVICE_ROLE_KEY is missing on the server, so the platform console cannot load." />;
  const db = createAdminClient();
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400000).toISOString();
  const [{ data: settings }, reqs, { data: recent }, { data: pays }, { data: ending }, { data: companies }] = await Promise.all([
    db.from("lb_platform_settings").select("upi_id").maybeSingle(),
    db.from("lb_plan_requests").select("id,company_id,plan_name,seats,period_days,amount_inr,utr,created_at").eq("status", "pending").order("created_at"),
    db.from("lb_plan_requests").select("id,company_id,plan_name,amount_inr,utr,status,note,reviewed_at").neq("status", "pending").order("reviewed_at", { ascending: false }).limit(20),
    db.from("lb_payments").select("id,company_id,provider,amount_paise,seats,period_days,created_at").order("created_at", { ascending: false }).limit(50),
    db.from("lb_billing").select("company_id,plan,paid_until,trial_ends_at").neq("plan", "internal").is("suspended_at", null).or(`and(paid_until.gt.${new Date().toISOString()},paid_until.lt.${soon}),and(plan.eq.trial,trial_ends_at.gt.${new Date().toISOString()},trial_ends_at.lt.${soon})`),
    db.from("lb_companies").select("id,name"),
  ]);
  if (reqs.error) return <ErrorBox message={/lb_plan_requests|schema cache/i.test(reqs.error.message) ? "Plan payments are not set up yet: run the database update (20261102060100_lb_plan_upi_billing.sql) once in Supabase." : reqs.error.message} />;
  const pending = reqs.data ?? [];
  const name = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const company = (id: string) => <Link href={`/platform/companies/${id}`} className="font-medium text-navy-900 hover:text-brand-700 hover:underline">{name.get(id) ?? "—"}</Link>;
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const thisMonth = (pays ?? []).filter((p) => new Date(p.created_at) >= month).reduce((n, p) => n + Number(p.amount_paise) / 100, 0);

  return (
    <>
      <PageHeader icon="rupee" tone="violet" title="Plan payments" sub="Subscription money from companies: verify UPI payments, see what came in and who needs to renew." />
      {!settings?.upi_id && <div className="mb-4"><Notice>Set your UPI ID in <Link href="/platform/wallet" className="font-medium underline">Wallet payments</Link> so companies can pay their plan by UPI.</Notice></div>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Kpi label="To verify" value={pending.length} icon="clock" tone="amber" />
        <Kpi label="Received this month" value={inr(Math.round(thisMonth))} icon="rupee" tone="green" />
        <Kpi label="Ending in 7 days" value={(ending ?? []).length} icon="calendar" tone="violet" />
      </div>

      <Panel title={`Waiting for verification (${pending.length})`} icon="clock" tone="amber" className="mb-5">
        <Table head={["Submitted", "Company", "Plan", "Amount", "UTR", ""]} empty={pending.length ? undefined : "Nothing to verify."}>
          {pending.map((r) => (
            <tr key={r.id}>
              <td className="td text-slate-500">{fmtDateTime(r.created_at)}</td>
              <td className="td">{company(r.company_id)}</td>
              <td className="td">{r.plan_name}<div className="text-xs text-slate-500">{r.seats} user{r.seats === 1 ? "" : "s"} · {r.period_days} days</div></td>
              <td className="td font-semibold">{inr(Number(r.amount_inr))}</td>
              <td className="td font-mono text-xs">{r.utr}</td>
              <td className="td"><PlanReviewForm id={r.id} amount={inr(Number(r.amount_inr))} /></td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Ending soon" icon="calendar" tone="violet" className="mb-5" sub="Paid plans and trials that end in the next 7 days. Their admins get reminders 7, 3 and 1 day before.">
        <Table head={["Company", "Status", "Ends"]} empty={(ending ?? []).length ? undefined : "No plan ends in the next 7 days."}>
          {(ending ?? []).map((b) => (
            <tr key={b.company_id}>
              <td className="td">{company(b.company_id)}</td>
              <td className="td capitalize">{b.plan}</td>
              <td className="td">{fmtDateTime(b.plan === "trial" ? b.trial_ends_at : b.paid_until)}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Payments received" icon="list" tone="green" className="mb-5">
        <Table head={["Date", "Company", "Via", "Amount", "Period"]} empty={(pays ?? []).length ? undefined : "No payments yet."}>
          {(pays ?? []).map((p) => (
            <tr key={p.id}>
              <td className="td text-slate-500">{fmtDateTime(p.created_at)}</td>
              <td className="td">{company(p.company_id)}</td>
              <td className="td">{PROVIDER[p.provider] ?? (p.provider.startsWith("manual") ? "Manual" : p.provider)}</td>
              <td className="td font-semibold">{inr(Number(p.amount_paise) / 100)}</td>
              <td className="td text-slate-500">{p.seats} user{p.seats === 1 ? "" : "s"} · {p.period_days} days</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Recently reviewed UPI payments" icon="list" tone="slate">
        <Table head={["Reviewed", "Company", "Plan", "Amount", "UTR", "Status"]} empty={(recent ?? []).length ? undefined : "None yet."}>
          {(recent ?? []).map((r) => (
            <tr key={r.id}>
              <td className="td text-slate-500">{fmtDateTime(r.reviewed_at)}</td>
              <td className="td">{company(r.company_id)}</td>
              <td className="td">{r.plan_name}</td>
              <td className="td">{inr(Number(r.amount_inr))}</td>
              <td className="td font-mono text-xs">{r.utr}</td>
              <td className="td"><span className={`badge ${STATUS[r.status]?.[1] ?? ""}`}>{STATUS[r.status]?.[0] ?? r.status}</span>{r.note && <div className="mt-0.5 text-xs text-slate-500">{r.note}</div>}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
