import { loadRefs } from "@/lib/data";
import { leadCounts } from "../counts";
import { DepartmentList } from "./department-list";

export const metadata = { title: "Departments" };

export default async function SettingsDepartments() {
  const [refs, counts] = await Promise.all([loadRefs(), leadCounts()]);
  const bName = new Map(refs.branches.map((b) => [b.id, b.name]));
  return (
    <DepartmentList branches={refs.branches.filter((b) => b.is_active !== false)}
      rows={refs.departments.map((d) => ({ ...d, branch: d.branch_id ? bName.get(d.branch_id) ?? null : null, leads: counts.department[d.id] ?? 0 }))} />
  );
}
