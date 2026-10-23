import { loadRefs } from "@/lib/data";
import { PageHeader, StatusBadge } from "@/components/static";
import { StatusForm } from "./status-form";
import { CATEGORY_LABEL } from "@/lib/labels";

export const metadata = { title: "Statuses" };


export default async function StatusesPage() {
  const { statuses } = await loadRefs();
  return (
    <>
      <PageHeader title="Lead statuses" sub="Sales statuses (separate from chat Open/Pending/Resolved). Each maps to a stable reporting category so reports survive renames."
        actions={<StatusForm />} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="border-b bg-slate-50"><tr><th className="th">Order</th><th className="th">Status</th><th className="th">Reporting category</th><th className="th">Active</th><th className="th"></th></tr></thead>
          <tbody className="divide-y">
            {statuses.map((s) => (
              <tr key={s.id}>
                <td className="td">{s.sort_order}</td>
                <td className="td"><StatusBadge name={s.name} category={s.category} />{s.is_default && <span className="ml-2 text-xs text-slate-500">default</span>}</td>
                <td className="td">{CATEGORY_LABEL[s.category]}</td>
                <td className="td">{s.is_active ? "Yes" : "No"}</td>
                <td className="td text-right"><StatusForm status={s} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
