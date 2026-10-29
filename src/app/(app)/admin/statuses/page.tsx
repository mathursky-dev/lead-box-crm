import { loadRefs } from "@/lib/data";
import { PageHeader, StatusBadge } from "@/components/static";
import { StatusForm } from "./status-form";
import { SubStatusForm, DeleteSubStatus } from "./sub-status-form";
import { CATEGORY_LABEL } from "@/lib/labels";

export const metadata = { title: "Statuses" };


export default async function StatusesPage() {
  const { statuses, subStatuses } = await loadRefs();
  const statusName = new Map(statuses.map((s) => [s.id, s.name]));
  return (
    <>
      <PageHeader icon="list" tone="blue" title="Lead statuses" sub="Sales statuses (separate from chat Open/Pending/Resolved). Each maps to a stable reporting category so reports survive renames."
        actions={<StatusForm />} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Order</th><th className="th">Status</th><th className="th">Reporting category</th><th className="th">Active</th><th className="th"></th></tr></thead>
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

      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy-900">Sub-statuses</h2>
          <p className="text-sm text-slate-500">Finer outcome under a status, e.g. Not picked, Switched off, Out of station. Agents pick it on the lead page; the leads list shows and filters by it.</p>
        </div>
        <SubStatusForm statuses={statuses} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Order</th><th className="th">Sub-status</th><th className="th">Under status</th><th className="th">Active</th><th className="th"></th></tr></thead>
          <tbody className="divide-y">
            {subStatuses.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={5}>No sub-statuses yet.</td></tr>}
            {subStatuses.map((s) => (
              <tr key={s.id}>
                <td className="td">{s.sort_order}</td>
                <td className="td font-medium text-navy-900">{s.name}</td>
                <td className="td">{s.status_id ? statusName.get(s.status_id) ?? "—" : <span className="text-slate-500">Any status</span>}</td>
                <td className="td">{s.is_active ? "Yes" : "No"}</td>
                <td className="td text-right"><span className="inline-flex gap-1"><SubStatusForm sub={s} statuses={statuses} /><DeleteSubStatus id={s.id} name={s.name} /></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
