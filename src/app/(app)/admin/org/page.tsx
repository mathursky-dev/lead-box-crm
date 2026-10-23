import { loadRefs } from "@/lib/data";
import { PageHeader } from "@/components/static";
import { OrgList } from "../org-list";

export const metadata = { title: "Organisation" };

export default async function OrgPage() {
  const r = await loadRefs();
  const bName = new Map(r.branches.map((b) => [b.id, b.name]));
  const dName = new Map(r.departments.map((d) => [d.id, d.name]));
  return (
    <>
      <PageHeader title="Organisation" sub="Company → Branch → Department → Team → Users. Deactivate instead of deleting to keep history." />
      <div className="grid gap-4 lg:grid-cols-3">
        <OrgList table="lb_branches" title="Branches" items={r.branches} />
        <OrgList table="lb_departments" title="Departments" parents={[{ name: "branch_id", label: "Branch", options: r.branches }]}
          items={r.departments.map((d) => ({ ...d, sub: d.branch_id ? bName.get(d.branch_id) : undefined }))} />
        <OrgList table="lb_teams" title="Teams"
          parents={[{ name: "branch_id", label: "Branch", options: r.branches }, { name: "department_id", label: "Dept", options: r.departments }]}
          items={r.teams.map((t) => ({ ...t, sub: [t.branch_id && bName.get(t.branch_id), t.department_id && dName.get(t.department_id)].filter(Boolean).join(" · ") }))} />
      </div>
    </>
  );
}
