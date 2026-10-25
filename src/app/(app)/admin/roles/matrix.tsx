"use client";
import { ActionForm, Submit } from "@/components/ui";
import { saveRolePermissions } from "@/lib/actions/admin";

type Row = { key: string; label: string; module: string; agent: boolean; team_leader: boolean };

export function PermissionMatrix({ rows, counts }: { rows: Row[]; counts: Record<string, number> }) {
  const modules = [...new Set(rows.map((r) => r.module))];
  return (
    <ActionForm action={saveRolePermissions} className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Permission</th>
            <th className="th text-center">Agent <span className="font-normal normal-case text-slate-400">({counts.agent})</span></th>
            <th className="th text-center">Team Leader <span className="font-normal normal-case text-slate-400">({counts.team_leader})</span></th>
            <th className="th text-center">Company Admin <span className="font-normal normal-case text-slate-400">({counts.company_admin})</span></th>
            <th className="th text-center">Super Admin <span className="font-normal normal-case text-slate-400">({counts.super_admin})</span></th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => [
            <tr key={m} className="bg-slate-50/60"><td colSpan={5} className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">{m}</td></tr>,
            ...rows.filter((r) => r.module === m).map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <td className="td">{r.label}</td>
                <td className="td text-center"><input type="checkbox" name={`agent:${r.key}`} defaultChecked={r.agent} aria-label={`Agent: ${r.label}`} className="h-4 w-4 accent-brand-600" /></td>
                <td className="td text-center"><input type="checkbox" name={`team_leader:${r.key}`} defaultChecked={r.team_leader} aria-label={`Team Leader: ${r.label}`} className="h-4 w-4 accent-brand-600" /></td>
                <td className="td text-center text-brand-600" title="Admins always have every permission">✓</td>
                <td className="td text-center text-brand-600" title="Admins always have every permission">✓</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 border-t p-3">
        <Submit>Save permissions</Submit>
        <span className="text-xs text-slate-500">User management, organisation, WhatsApp setup and settings are always admin-only.</span>
      </div>
    </ActionForm>
  );
}
