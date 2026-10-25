import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel } from "@/components/kit";
import { fmtDay } from "@/lib/dates";
import { companyStatus, accessEnds, inr, STATUS_BADGE, type BillingRow, type Plan, type Status } from "@/lib/plans";
import { AddCompanyButton } from "./forms";

export const metadata = { title: "Companies" };

type Usage = { company_id: string; users: number; numbers: number; leads_month: number; leads_total: number; last_activity: string | null };

const FILTERS: [Status | "all" | "expiring", string][] = [
  ["all", "All"], ["paid", "Paid"], ["trial", "Trial"], ["expiring", "Expiring in 7 days"], ["expired", "Expired"], ["suspended", "Suspended"], ["internal", "Free forever"],
];

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireProfile();
  const { status = "all", q = "" } = await searchParams;
  if (!hasServiceRole()) return <ErrorBox message="SUPABASE_SERVICE_ROLE_KEY is missing on the server, so the platform console cannot load." />;
  const db = createAdminClient();
  const now = new Date().getTime();
  const since = new Date(now - 30 * 86400000).toISOString();
  const [{ data: companies, error }, { data: billing }, { data: plans }, { data: usage }, { data: payments }, { data: admins }, { data: wallets }] = await Promise.all([
    db.from("lb_companies").select("id,name,created_at").order("created_at", { ascending: false }),
    db.from("lb_billing").select("*"),
    db.from("lb_plans").select("*").order("sort"),
    db.rpc("lb_platform_usage"),
    db.from("lb_payments").select("company_id,amount_paise,created_at").gte("created_at", since),
    db.from("lb_profiles").select("company_id,full_name,email,phone").eq("role", "company_admin").eq("is_active", true).order("created_at"),
    db.from("lb_wallets").select("company_id,balance"),
  ]);
  if (error) return <ErrorBox message={error.message} />;

  const bill = new Map(((billing ?? []) as BillingRow[]).map((b) => [b.company_id, b]));
  const planName = new Map(((plans ?? []) as Plan[]).map((p) => [p.id, p.name]));
  const use = new Map(((usage ?? []) as Usage[]).map((u) => [u.company_id, u]));
  const admin = new Map<string, { full_name: string; email: string; phone: string | null }>();
  (admins ?? []).forEach((a) => { if (!admin.has(a.company_id)) admin.set(a.company_id, a); });
  const wallet = new Map((wallets ?? []).map((w) => [w.company_id, Number(w.balance)]));


  const week = now + 7 * 86400000;
  const rows = (companies ?? []).map((c) => {
    const b = bill.get(c.id);
    const s = companyStatus(b, now);
    const ends = b ? accessEnds(b, s) : null;
    return { ...c, b, s, ends, expiring: Boolean(ends && new Date(ends).getTime() < week), u: use.get(c.id), a: admin.get(c.id) };
  });
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const revenue = (payments ?? []).reduce((n, p) => n + Number(p.amount_paise) / 100, 0);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (status === "all" || (status === "expiring" ? r.expiring : r.s === status)) &&
    (!needle || [r.name, r.a?.email, r.a?.full_name, r.a?.phone].some((v) => v?.toLowerCase().includes(needle))));

  const activePlans = ((plans ?? []) as Plan[]).filter((p) => p.is_active);
  return (
    <>
      <PageHeader icon="building" tone="violet" title="Companies" sub="Every company using Lead Box: plan, access, usage and billing."
        actions={<AddCompanyButton plans={activePlans.map((p) => ({ id: p.id, name: p.name, trial_days: p.trial_days, period_days: p.period_days }))} />} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Companies" value={rows.length} icon="building" tone="violet" href="/platform" />
        <Kpi label="Paid" value={count((r) => r.s === "paid")} icon="check" tone="green" href="/platform?status=paid" />
        <Kpi label="On trial" value={count((r) => r.s === "trial")} icon="clock" tone="blue" href="/platform?status=trial" />
        <Kpi label="Expiring in 7 days" value={count((r) => r.expiring)} sub={`${count((r) => r.s === "expired")} expired · ${count((r) => r.s === "suspended")} suspended`} icon="alert" tone="amber" href="/platform?status=expiring" />
        <Kpi label="Revenue (30 days)" value={inr(Math.round(revenue))} sub={`${(payments ?? []).length} payment${(payments ?? []).length === 1 ? "" : "s"}`} icon="rupee" tone="green" />
      </div>

      <Panel title="All companies" icon="list" tone="violet"
        actions={
          <form className="flex gap-2" action="/platform">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            <input className="input h-8 w-48 py-1" name="q" defaultValue={q} placeholder="Search name, email, phone" />
            <button className="btn-ghost btn-sm">Search</button>
          </form>
        }>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={v === "all" ? "/platform" : `/platform?status=${v}`}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === v ? "border-transparent bg-violet-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{label}</Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">Company</th><th className="th">Plan</th><th className="th">Status</th><th className="th">Access until</th>
              <th className="th">Users</th><th className="th">Numbers</th><th className="th">Leads (month)</th><th className="th">Wallet</th><th className="th">Joined</th>
            </tr></thead>
            <tbody className="divide-y">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td">
                    <Link href={`/platform/companies/${r.id}`} className="font-medium text-navy-900 hover:text-brand-700 hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.a ? `${r.a.full_name} · ${r.a.email}` : "No admin"}</div>
                  </td>
                  <td className="td">{(r.b?.plan_id && planName.get(r.b.plan_id)) || "—"}</td>
                  <td className="td"><span className={`badge ${STATUS_BADGE[r.s][1]}`}>{STATUS_BADGE[r.s][0]}</span></td>
                  <td className={`td ${r.expiring ? "font-medium text-amber-700" : ""}`}>{r.s === "internal" ? "No expiry" : fmtDay(r.ends ?? r.b?.paid_until ?? r.b?.trial_ends_at)}</td>
                  <td className="td">{r.u?.users ?? 0}</td>
                  <td className="td">{r.u?.numbers ?? 0}</td>
                  <td className="td">{(r.u?.leads_month ?? 0).toLocaleString("en-IN")}</td>
                  <td className="td">{inr(Math.round(wallet.get(r.id) ?? 0))}</td>
                  <td className="td text-slate-500">{fmtDay(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <div className="px-3 py-6 text-center text-sm text-slate-500">No companies match.</div>}
        </div>
      </Panel>
    </>
  );
}
