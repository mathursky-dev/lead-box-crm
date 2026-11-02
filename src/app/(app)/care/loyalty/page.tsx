import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { Kpi, Table } from "@/components/kit";
import { fmtDateTime, money } from "@/lib/dates";
import { nowMs } from "@/lib/care";
import { LEDGER_SOURCE } from "@/lib/retention";
import { retentionSettings, RET_NOT_READY, retNotReady } from "@/lib/retention-server";
import { AdjustButton, RedeemButton } from "../retention-ui";

export const metadata = { title: "Loyalty points" };

type SP = Record<string, string | undefined>;

export default async function LoyaltyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const cid = profile.company_id;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const since = new Date(nowMs() - 30 * 86400000).toISOString();
  const [s, { data: board, error }, { data: recent }, { data: month }] = await Promise.all([
    retentionSettings(sb, cid),
    sb.rpc("lb_loyalty_board", { p_limit: 200, p_search: q || null }),
    sb.from("lb_loyalty_ledger").select("id,source,points,amount,note,created_at,customer:lb_customers(name,phone_e164)").eq("company_id", cid).order("created_at", { ascending: false }).limit(50),
    sb.from("lb_loyalty_ledger").select("source,points").eq("company_id", cid).gte("created_at", since).limit(20000),
  ]);
  if (!s || error) return <ErrorBox message={!s || retNotReady(error?.message ?? "") ? RET_NOT_READY : error!.message} />;
  const rows = (board ?? []) as { customer_id: string; name: string | null; phone_e164: string; balance: number; earned: number; redeemed: number; last_at: string }[];
  const outstanding = q ? null : rows.reduce((n, r) => n + Math.max(r.balance, 0), 0);
  const earned30 = (month ?? []).filter((r) => r.points > 0 && r.source !== "adjust").reduce((n, r) => n + Number(r.points), 0);
  const redeemed30 = -(month ?? []).filter((r) => r.source === "redeem").reduce((n, r) => n + Number(r.points), 0);
  return (
    <div className="space-y-4">
      {!s.loyalty_enabled && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
          Loyalty points are off, so purchases don&apos;t earn points yet. {isAdmin(profile) ? <Link href="/care/settings" className="font-medium text-brand-700 underline">Turn them on</Link> : "Ask your admin to turn them on."}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Points with customers" value={outstanding == null ? "—" : outstanding.toLocaleString("en-IN")} sub={outstanding == null ? undefined : `= ${money(outstanding * s.point_value)} discount liability`} icon="trophy" tone="green" />
        <Kpi label="Earned (30 days)" value={earned30.toLocaleString("en-IN")} icon="sparkle" tone="blue" />
        <Kpi label="Redeemed (30 days)" value={redeemed30.toLocaleString("en-IN")} sub={money(redeemed30 * s.point_value)} icon="gift" tone="violet" />
        <Kpi label="Rule" value={`${s.points_per_100} pt / ₹100`} sub={`1 pt = ₹${s.point_value} · min ${s.min_redeem}`} icon="percent" tone="amber" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action="/care/loyalty" className="flex gap-2">
          <input className="input !w-56 !py-1.5" name="q" defaultValue={q} placeholder="Search name or mobile" aria-label="Search customers" />
        </form>
        {isAdmin(profile) && <span className="ml-auto"><AdjustButton label="+ Add / remove points" className="btn-primary btn-sm" /></span>}
      </div>
      <div className="card overflow-hidden">
        <Table head={["Customer", "Balance", "Earned", "Redeemed", "Last activity", ""]} empty={rows.length ? undefined : q ? "No customer found." : "No points yet. Points appear when leads are Won."}>
          {rows.map((r) => (
            <tr key={r.customer_id}>
              <td className="td">{r.name || "—"}<div className="text-xs text-slate-500">{r.phone_e164}</div></td>
              <td className="td"><b className="text-navy-900">{r.balance.toLocaleString("en-IN")}</b><div className="text-xs text-slate-500">= {money(r.balance * s.point_value)}</div></td>
              <td className="td">{r.earned.toLocaleString("en-IN")}</td>
              <td className="td">{r.redeemed.toLocaleString("en-IN")}</td>
              <td className="td whitespace-nowrap text-xs text-slate-500">{r.last_at ? fmtDateTime(r.last_at) : "—"}</td>
              <td className="td">
                <div className="flex gap-1.5">
                  {s.loyalty_enabled && r.balance > 0 && <RedeemButton customerId={r.customer_id} balance={r.balance} pointValue={s.point_value} minRedeem={s.min_redeem} maxPct={s.max_redeem_pct} className="btn-ghost btn-sm" />}
                  {isAdmin(profile) && <AdjustButton customerId={r.customer_id} />}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="card overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold text-navy-900">Recent activity</h2>
        <Table head={["When", "Customer", "Type", "Points", "Details"]} empty={recent?.length ? undefined : "Nothing yet."}>
          {(recent ?? []).map((g) => {
            const c = g.customer as unknown as { name: string | null; phone_e164: string } | null;
            const pts = Number(g.points);
            return (
              <tr key={g.id as string}>
                <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDateTime(g.created_at as string)}</td>
                <td className="td">{c?.name || c?.phone_e164 || "—"}</td>
                <td className="td text-sm">{LEDGER_SOURCE[g.source as string] ?? g.source}</td>
                <td className={`td font-semibold ${pts > 0 ? "text-brand-700" : "text-red-600"}`}>{pts > 0 ? `+${pts}` : pts}</td>
                <td className="td text-sm text-slate-600">{g.note as string}{g.source === "redeem" && g.amount ? ` · ₹${Number(g.amount).toLocaleString("en-IN")} off` : ""}</td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
