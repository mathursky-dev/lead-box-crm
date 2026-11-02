import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { leadCounts } from "../counts";
import { StatusList, type StatusRow } from "./status-list";
import { SubStatusForm, DeleteSubStatus } from "../../admin/statuses/sub-status-form";

export const metadata = { title: "Manage Status" };

export default async function SettingsStatuses() {
  const cid = (await getSession())?.profile?.company_id ?? "";
  const sb = await createClient();
  const [{ data }, refs] = await Promise.all([
    sb.from("lb_lead_statuses").select("id,name,category,sort_order,is_active,is_default,color").eq("company_id", cid).order("sort_order").order("name"),
    loadRefs(),
  ]);
  const rows = (data ?? []) as StatusRow[];
  const counts = (await leadCounts()).status;
  const statusName = new Map(rows.map((s) => [s.id, s.name]));
  return (
    <div className="space-y-6">
      <StatusList rows={rows.map((r) => ({ ...r, leads: counts[r.id] ?? 0 }))} />
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-navy-900">Sub-statuses</h2>
            <p className="text-xs text-slate-500">Finer outcome under a status, e.g. Not picked, Switched off, Out of station.</p>
          </div>
          <SubStatusForm statuses={refs.statuses} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="border-b border-slate-200"><tr><th className="th">Order</th><th className="th">Sub-status</th><th className="th">Under status</th><th className="th">Active</th><th className="th"></th></tr></thead>
            <tbody className="divide-y">
              {refs.subStatuses.length === 0 && <tr><td className="td text-sm text-slate-500" colSpan={5}>No sub-statuses yet.</td></tr>}
              {refs.subStatuses.map((s) => (
                <tr key={s.id}>
                  <td className="td">{s.sort_order}</td>
                  <td className="td font-medium text-navy-900">{s.name}</td>
                  <td className="td">{s.status_id ? statusName.get(s.status_id) ?? "—" : <span className="text-slate-500">Any status</span>}</td>
                  <td className="td">{s.is_active ? "Yes" : "No"}</td>
                  <td className="td text-right"><span className="inline-flex gap-1"><SubStatusForm sub={s} statuses={refs.statuses} /><DeleteSubStatus id={s.id} name={s.name} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
