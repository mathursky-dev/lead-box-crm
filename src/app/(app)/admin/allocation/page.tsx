import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, Empty } from "@/components/static";
import { RuleForm, DeleteRule } from "./rule-form";

export const metadata = { title: "Allocation rules" };

export default async function AllocationPage() {
  const refs = await loadRefs();
  const sb = await createClient();
  const [{ data: rules }, { data: ru }, { data: counts }] = await Promise.all([
    sb.from("lb_allocation_rules").select("*").order("priority"),
    sb.from("lb_allocation_rule_users").select("rule_id,user_id"),
    sb.rpc("lb_open_lead_counts"),
  ]);
  const name = (list: { id: string; name?: string; label?: string }[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? list.find((x) => x.id === id)?.label : null);
  const open = new Map(((counts ?? []) as { owner_id: string; open_leads: number }[]).map((c) => [c.owner_id, Number(c.open_leads)]));
  const users = refs.users.map((u) => ({ id: u.id, name: u.full_name, active: u.is_active }));
  return (
    <>
      <PageHeader title="Allocation rules"
        sub="New unassigned leads are matched to the first active rule (lowest priority number) whose conditions all match, then given round-robin to its eligible users: active, opted into auto-allocation, and under their open-lead limit."
        actions={<RuleForm refs={refs} users={users} />} />
      {!rules?.length ? <Empty title="No rules yet">Without rules, new leads stay in the unassigned queue for manual assignment.</Empty> : (
        <div className="space-y-3">
          {rules.map((r) => {
            const members = (ru ?? []).filter((x) => x.rule_id === r.id).map((x) => x.user_id);
            const conds = [
              ["Number", name(refs.numbers, r.match_number_id)], ["Branch", name(refs.branches, r.match_branch_id)], ["Department", name(refs.departments, r.match_department_id)],
              ["Product", name(refs.products, r.match_product_id)], ["Source", name(refs.sources, r.match_source_id)],
            ].filter(([, v]) => v);
            return (
              <div key={r.id} className={`card p-4 ${r.is_active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-navy-900">#{r.priority} · {r.name} {!r.is_active && <span className="badge bg-slate-200">inactive</span>}</div>
                    <div className="text-xs text-slate-500">{conds.length ? conds.map(([k, v]) => `${k}: ${v}`).join(" · ") : "Matches every lead"}</div>
                  </div>
                  <div className="flex gap-1"><RuleForm refs={refs} users={users} rule={{ ...r, users: members }} /><DeleteRule id={r.id} name={r.name} /></div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {members.map((m) => {
                    const u = refs.users.find((x) => x.id === m);
                    return <span key={m} className={`badge ${u?.is_active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-400 line-through"}`}>{u?.full_name} · {open.get(m) ?? 0} open{r.last_user_id === m ? " · last" : ""}</span>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
