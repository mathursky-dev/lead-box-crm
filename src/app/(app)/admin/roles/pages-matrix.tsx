"use client";
import { useState } from "react";
import { ActionForm, Submit } from "@/components/ui";
import { savePageAccess } from "@/lib/actions/admin";

type Page = { key: string; label: string; edit?: string; delete?: string };
type Cell = { view: boolean; edit: boolean; delete: boolean };
type Value = Record<string, Cell>; // key: role:page

const ROLES = [["agent", "Agent"], ["team_leader", "Team Leader"]] as const;

export function PageAccessMatrix({ pages, value }: { pages: Page[]; value: Value }) {
  const [v, setV] = useState(value);
  const cell = (role: string, page: string): Cell => v[`${role}:${page}`] ?? { view: true, edit: true, delete: true };
  const set = (role: string, page: string, k: keyof Cell, on: boolean) =>
    setV((s) => ({ ...s, [`${role}:${page}`]: { ...cell(role, page), [k]: on } }));
  const box = (role: string, p: Page, k: keyof Cell, label: string) => {
    const c = cell(role, p.key);
    const disabled = k !== "view" && !c.view;
    return (
      <label className={`inline-flex items-center gap-1 text-xs ${disabled ? "text-slate-300" : "text-slate-600"}`}>
        <input type="checkbox" name={`${role}:${p.key}:${k}`} checked={c[k] && (k === "view" || c.view)} disabled={disabled}
          onChange={(e) => set(role, p.key, k, e.target.checked)} className="h-4 w-4 accent-brand-600" aria-label={`${role === "agent" ? "Agent" : "Team Leader"}: ${label} ${p.label}`} />
        {label}
      </label>
    );
  };
  return (
    <ActionForm action={savePageAccess} className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Page</th>
            {ROLES.map(([r, l]) => <th key={r} className="th">{l}</th>)}
            <th className="th text-center">Admins</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.key} className="border-b last:border-0">
              <td className="td">
                <div className="font-medium text-navy-900">{p.label}</div>
                {(p.edit || p.delete) && <div className="text-xs text-slate-400">{[p.edit && `Edit = ${p.edit}`, p.delete && `Delete = ${p.delete}`].filter(Boolean).join(" · ")}</div>}
              </td>
              {ROLES.map(([r]) => (
                <td key={r} className="td">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {box(r, p, "view", "View")}
                    {p.edit && box(r, p, "edit", "Edit")}
                    {p.delete && box(r, p, "delete", "Delete")}
                  </div>
                </td>
              ))}
              <td className="td text-center text-brand-600" title="Admins always have full access">✓</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 border-t p-3">
        <Submit>Save page access</Submit>
        <span className="text-xs text-slate-500">Untick View to hide a page from the menu and block its link. Admin pages are always admin-only. Dashboard is always visible.</span>
      </div>
    </ActionForm>
  );
}
