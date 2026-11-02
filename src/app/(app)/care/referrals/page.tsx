import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { Kpi, PillTabs, Table } from "@/components/kit";
import { fmtDateTime, money } from "@/lib/dates";
import { refStatus } from "@/lib/care";
import { RefStatus } from "../ui";

export const metadata = { title: "Referrals" };

type SP = Record<string, string | undefined>;
const VIEWS = [{ key: "all", label: "All" }, { key: "won", label: "Reward due" }, { key: "pending", label: "In progress" }, { key: "rewarded", label: "Rewarded" }];
type Cust = { id: string; name: string | null; phone_e164: string } | null;

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const cid = profile.company_id;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "all";
  let q = sb.from("lb_referrals").select("id,status,channel,reward_note,rewarded_at,created_at,lead_id,referrer:lb_customers!lb_referrals_referrer_customer_id_fkey(id,name,phone_e164),friend:lb_customers!lb_referrals_customer_id_fkey(id,name,phone_e164),lead:lb_leads(lead_no,won_value)").eq("company_id", cid);
  if (view !== "all") q = q.eq("status", view);
  const [{ data, error }, { data: all }, { data: s }] = await Promise.all([
    q.order("created_at", { ascending: false }).limit(200),
    sb.from("lb_referrals").select("status,referrer_customer_id,lead:lb_leads(won_value),referrer:lb_customers!lb_referrals_referrer_customer_id_fkey(name,phone_e164)").eq("company_id", cid).limit(5000),
    sb.from("lb_care_settings").select("referral_enabled,referral_reward").eq("company_id", cid).maybeSingle(),
  ]);
  if (error) return <ErrorBox message={/lb_referrals|schema cache/i.test(error.message) ? "Customer care is not set up yet: the database update has to be run once (Supabase SQL)." : error.message} />;
  const rows = all ?? [];
  const won = rows.filter((r) => r.status === "won" || r.status === "rewarded");
  const revenue = won.reduce((n, r) => n + Number((r.lead as unknown as { won_value: number | null } | null)?.won_value ?? 0), 0);
  const top = [...rows.reduce((m, r) => {
    const k = r.referrer_customer_id as string, ref = r.referrer as unknown as { name: string | null; phone_e164: string } | null;
    const e = m.get(k) ?? { name: ref?.name || ref?.phone_e164 || "—", total: 0, won: 0 };
    e.total++; if (r.status === "won" || r.status === "rewarded") e.won++;
    return m.set(k, e);
  }, new Map<string, { name: string; total: number; won: number }>()).values()].sort((a, b) => b.won - a.won || b.total - a.total).slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        {s?.referral_enabled === false ? "The referral program is off (Settings). " : ""}
        Every customer has a personal referral link: open any lead → <b>Customer care</b> panel → send the referral link. Friends who fill it become leads with source <b>Referral</b>.
        {s?.referral_reward ? <> Reward: <b>{s.referral_reward}</b>.</> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Referrals" value={rows.length} icon="gift" tone="green" />
        <Kpi label="Converted" value={won.length} sub={rows.length ? `${Math.round((won.length / rows.length) * 100)}%` : undefined} icon="trophy" tone="blue" />
        <Kpi label="Reward due" value={rows.filter((r) => r.status === "won").length} icon="alert" tone="amber" href="/care/referrals?view=won" />
        <Kpi label="Revenue from referrals" value={money(revenue)} icon="rupee" tone="violet" />
      </div>
      {top.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Top referrers</h2>
          <ol className="space-y-1 text-sm">{top.map((t, i) => <li key={i} className="flex justify-between gap-2"><span>{i + 1}. {t.name}</span><span className="text-slate-500">{t.total} referred · <b className="text-navy-900">{t.won} won</b></span></li>)}</ol>
        </div>
      )}
      <PillTabs label="Referral views" tabs={VIEWS.map((v) => ({ href: `/care/referrals?view=${v.key}`, label: v.label, active: v.key === view }))} />
      <div className="card overflow-hidden">
        <Table head={["Referred by", "Friend", "Lead", "Status", "Reward", "Date"]} empty={data?.length ? undefined : "No referrals yet."}>
          {(data ?? []).map((r) => {
            const ref = r.referrer as unknown as Cust, fr = r.friend as unknown as Cust, lead = r.lead as unknown as { lead_no: number; won_value: number | null } | null;
            const st = refStatus(r.status as string);
            return (
              <tr key={r.id as string}>
                <td className="td">{ref?.name || "—"}<div className="text-xs text-slate-500">{ref?.phone_e164}</div></td>
                <td className="td">{fr?.name || "—"}<div className="text-xs text-slate-500">{fr?.phone_e164}</div></td>
                <td className="td">{r.lead_id && lead ? <Link href={`/leads/${r.lead_id}`} className="text-brand-700 hover:underline">LB-{lead.lead_no}</Link> : "—"}{lead?.won_value ? <div className="text-xs text-slate-500">Won {money(lead.won_value)}</div> : null}</td>
                <td className="td"><span className="sr-only">{st.label}</span><RefStatus id={r.id as string} status={r.status as string} /></td>
                <td className="td text-xs text-slate-600">{r.status === "rewarded" ? <>{(r.reward_note as string) || "Given"}<div className="text-slate-400">{fmtDateTime(r.rewarded_at as string)}</div></> : "—"}</td>
                <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDateTime(r.created_at as string)}<div>{r.channel === "link" ? "via link" : "added by staff"}</div></td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
