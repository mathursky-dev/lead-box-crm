import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel, Notice } from "@/components/kit";
import { inr } from "@/lib/plans";
import { BranchEditButton } from "./branch-edit";

export const metadata = { title: "Branches" };

type Branch = { id: string; name: string; is_active: boolean; code: string | null; city: string | null; address: string | null; phone: string | null; manager_id: string | null };
type Sum = { branch_id: string | null; users: number; leads: number; open_leads: number; new_leads: number; won: number; won_value: number; lost: number; overdue: number };

/** Branch-wise view of one company: details + this month's numbers per branch. */
export default async function BranchesPage() {
  const { profile, company } = await requireAdmin();
  const sb = await createClient();
  const monthStart = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: branches, error }, { data: summary, error: sErr }, { data: users }] = await Promise.all([
    sb.from("lb_branches").select("id,name,is_active,code,city,address,phone,manager_id").eq("company_id", profile.company_id).order("name"),
    sb.rpc("lb_branch_summary", { p_from: new Date(monthStart.getTime() - 330 * 60000).toISOString() }),
    sb.from("lb_profiles").select("id,full_name,branch_id,branch_scope,is_active").eq("company_id", profile.company_id).eq("is_active", true).order("full_name"),
  ]);
  if (error || sErr) return <ErrorBox message={(error ?? sErr)!.message} />;
  const lock = (profile as { branch_scope?: boolean }).branch_scope && profile.branch_id ? profile.branch_id : null;
  const all = ((branches ?? []) as Branch[]).filter((b) => !lock || b.id === lock);
  const sums = new Map(((summary ?? []) as Sum[]).map((r) => [r.branch_id ?? "none", r]));
  const people = (users ?? []) as { id: string; full_name: string; branch_id: string | null; branch_scope: boolean }[];
  const name = new Map(people.map((u) => [u.id, u.full_name]));
  const none = sums.get("none");
  const total = (k: keyof Sum) => [...sums.values()].reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const conv = (r?: Sum) => (r && Number(r.new_leads) ? Math.round((Number(r.won) / Number(r.new_leads)) * 100) : 0);

  return (
    <>
      <PageHeader icon="pin" tone="blue" title="Branches" sub={`${company?.name ?? ""}: each branch's team, leads and sales this month. Add or rename branches in Organisation.`}
        actions={<><Link href="/reports?tab=branch" className="btn-ghost">Branch reports</Link>{!lock && <Link href="/admin/org" className="btn-primary">+ Add branch</Link>}</>} />
      {!all.length && <Notice tone="amber">No branches yet. Add them in <Link href="/admin/org" className="underline">Organisation</Link>, then set each user&apos;s branch.</Notice>}

      {!lock && all.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Branches" value={all.filter((b) => b.is_active).length} icon="pin" tone="blue" />
          <Kpi label="New leads (month)" value={total("new_leads").toLocaleString("en-IN")} icon="target" tone="amber" />
          <Kpi label="Won (month)" value={total("won").toLocaleString("en-IN")} sub={inr(Math.round(total("won_value")))} icon="trophy" tone="green" />
          <Kpi label="Leads without branch" value={Number(none?.leads ?? 0).toLocaleString("en-IN")} sub="New leads take the owner's branch" icon="alert" tone="violet"
            href={none?.leads ? "/leads" : undefined} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {all.map((b) => {
          const r = sums.get(b.id);
          const scoped = people.filter((u) => u.branch_id === b.id && u.branch_scope).length;
          return (
            <Panel key={b.id} title={`${b.name}${b.code ? ` (${b.code})` : ""}`} icon="pin" tone={b.is_active ? "blue" : "slate"}
              sub={[b.city, b.manager_id && `Manager: ${name.get(b.manager_id) ?? "—"}`, !b.is_active && "Inactive"].filter(Boolean).join(" · ") || undefined}
              actions={<BranchEditButton branch={b} users={people.map((u) => ({ id: u.id, full_name: u.full_name }))} />}>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {([["Users", r?.users], ["Open leads", r?.open_leads], ["Overdue", r?.overdue], ["New (month)", r?.new_leads], ["Won (month)", r?.won], ["Lost (month)", r?.lost]] as [string, number | undefined][]).map(([l, n]) => (
                  <div key={l} className="rounded-lg bg-slate-50 px-2 py-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{l}</dt>
                    <dd className={`text-lg font-semibold ${l === "Overdue" && Number(n) > 0 ? "text-red-600" : "text-navy-900"}`}>{Number(n ?? 0).toLocaleString("en-IN")}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">Won value <b className="text-navy-900">{inr(Math.round(Number(r?.won_value ?? 0)))}</b> · Conversion <b className="text-navy-900">{conv(r)}%</b></span>
                <Link href={`/leads?branch_id=${b.id}`} className="font-medium text-brand-700 hover:underline">View leads →</Link>
              </div>
              {(b.address || b.phone) && <p className="mt-2 text-xs text-slate-500">{[b.address, b.phone].filter(Boolean).join(" · ")}</p>}
              <p className="mt-1 text-xs text-slate-500">{scoped ? `${scoped} user${scoped === 1 ? "" : "s"} with Branch access` : "No one has Branch access yet"}</p>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
