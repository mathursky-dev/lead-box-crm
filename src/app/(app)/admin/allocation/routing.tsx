"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/kit";
import { LANGUAGES, langName } from "@/lib/languages";
import {
  saveRouteRule, setRouteRuleActive, deleteRouteRule,
  addRouteMember, updateRouteMember, setRouteMemberActive, deleteRouteMember, saveReplySla,
} from "@/lib/actions/routing";
import { DetailsModal, IconBtn, Msg, Switch, useRun, type MemberApi, type MemberRow, type UserLite } from "./allocation";

export type RuleRow = { id: string; name: string; priority: number; active: boolean; productIds: string[]; languages: string[]; sourceIds: string[]; mode: "ratio" | "least_load" };
type Opt = { id: string; name: string };

const ROUTE_API: MemberApi = { add: addRouteMember, update: updateRouteMember, setActive: setRouteMemberActive, remove: deleteRouteMember };

/** A compact multi-select: button shows the picks, panel lists checkboxes. Nothing picked = any. */
function MultiPick({ label, options, value, onChange }: { label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const names = options.filter((o) => value.includes(o.id)).map((o) => o.name);
  return (
    <div className="relative">
      <span className="label">{label}</span>
      <button type="button" className="input flex items-center justify-between text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`truncate ${names.length ? "text-navy-900" : "text-slate-400"}`}>{names.length ? names.join(", ") : "Any"}</span>
        <Icon name="chevronDown" className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full min-w-[200px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-navy-900 hover:bg-brand-50">
              <input type="checkbox" checked={value.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />
              {o.name}
            </label>
          ))}
          {!options.length && <div className="px-3 py-2 text-sm text-slate-500">Nothing to pick yet</div>}
          <div className="flex justify-between border-t border-slate-100 px-3 pt-1.5">
            <button type="button" className="text-xs font-medium text-slate-500 hover:underline" onClick={() => onChange([])}>Any</button>
            <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleForm({ row, products, sources, pending, onSave, onCancel }: {
  row?: RuleRow; products: Opt[]; sources: Opt[]; pending: boolean;
  onSave: (v: Parameters<typeof saveRouteRule>[1]) => void; onCancel?: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [priority, setPriority] = useState(String(row?.priority ?? 10));
  const [prods, setProds] = useState<string[]>(row?.productIds ?? []);
  const [langs, setLangs] = useState<string[]>(row?.languages ?? []);
  const [srcs, setSrcs] = useState<string[]>(row?.sourceIds ?? []);
  const [mode, setMode] = useState<RuleRow["mode"]>(row?.mode ?? "ratio");
  return (
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.5fr_1fr_1fr_1fr_1fr_auto]">
      <label className="block"><span className="label">Rule name</span><input className="input" placeholder="e.g. Hindi kitchen leads" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block"><span className="label">Order</span><input className="input" type="number" min={1} max={1000} value={priority} onChange={(e) => setPriority(e.target.value)} title="Lower number is checked first" /></label>
      <MultiPick label="Product" options={products} value={prods} onChange={setProds} />
      <MultiPick label="Language" options={LANGUAGES.map((l) => ({ id: l.code, name: l.name }))} value={langs} onChange={setLangs} />
      <MultiPick label="Source" options={sources} value={srcs} onChange={setSrcs} />
      <label className="block"><span className="label">Give leads by</span>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as RuleRow["mode"])}>
          <option value="ratio">Ratio (turns)</option>
          <option value="least_load">Workload (fewest open leads)</option>
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={!name.trim() || pending}
          onClick={() => onSave({ name, priority, products: prods, languages: langs, sources: srcs, mode })}>
          {row ? "Save" : <><Icon name="plus" className="h-4 w-4" /> Add</>}
        </button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

export function RoutingBoard({ rules, members, users, products, sources }: { rules: RuleRow[]; members: MemberRow[]; users: UserLite[]; products: Opt[]; sources: Opt[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const { pending, msg, run } = useRun();
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const prodName = new Map(products.map((p) => [p.id, p.name]));
  const srcName = new Map(sources.map((p) => [p.id, p.name]));
  const current = rules.find((r) => r.id === openId) ?? null;
  const matchText = (r: RuleRow) => {
    const parts = [
      r.productIds.length ? r.productIds.map((x) => prodName.get(x) ?? "Deleted product").join(" / ") : null,
      r.languages.length ? r.languages.map(langName).join(" / ") : null,
      r.sourceIds.length ? r.sourceIds.map((x) => srcName.get(x) ?? "Deleted source").join(" / ") : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" + ") : "All leads";
  };

  return (
    <section className="card mb-4 overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-amber-50 text-amber-600"><Icon name="filter" className="h-3.5 w-3.5" /></span>
          Routing rules <span className="badge bg-amber-50 text-amber-700">checked first</span>
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Send new leads to the right people by product, language or source. Leave a field as &quot;Any&quot; to match everything.
          Rules are checked in order (lowest number first). &quot;Workload&quot; gives the lead to whoever in the rule has the fewest open leads.
          If no rule matches, or nobody in it can take the lead, the city-wise and source lists below work as before.
          The language is detected from the customer&apos;s first WhatsApp message (Hindi script or Hinglish words = Hindi), a form field called
          &quot;language&quot;, or set by hand on the lead.
        </p>
      </div>
      <div className="space-y-2 px-4 py-3">
        <RuleForm key={formKey} products={products} sources={sources} pending={pending} onSave={(v) => run(() => saveRouteRule(null, v), () => setFormKey((k) => k + 1))} />
        <Msg msg={msg} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50"><tr><th className="th">#</th><th className="th">Rule</th><th className="th">Matches</th><th className="th">By</th><th className="th">Users</th><th className="th">Status</th><th className="th">Actions</th></tr></thead>
          <tbody className="divide-y">
            {rules.map((r) => {
              const on = members.filter((m) => m.allocId === r.id && m.active);
              if (editId === r.id) return (
                <tr key={r.id}><td className="td" colSpan={7}>
                  <RuleForm row={r} products={products} sources={sources} pending={pending} onCancel={() => setEditId(null)}
                    onSave={(v) => run(() => saveRouteRule(r.id, v), () => setEditId(null))} />
                </td></tr>
              );
              return (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="td text-slate-500">{r.priority}</td>
                  <td className="td font-medium text-navy-900"><button type="button" className="hover:text-brand-700 hover:underline" onClick={() => setOpenId(r.id)}>{r.name}</button></td>
                  <td className="td max-w-xs text-slate-600">{matchText(r)}</td>
                  <td className="td">{r.mode === "least_load" ? <span className="badge bg-sky-50 text-sky-700">Workload</span> : <span className="badge bg-violet-50 text-violet-700">Ratio</span>}</td>
                  <td className="td">
                    {on.length ? (
                      <div className="flex flex-wrap gap-1">{on.map((m) => <span key={m.id} className="badge bg-slate-100 text-navy-800">{userName.get(m.userId) ?? "?"}{r.mode === "ratio" && <b className="text-violet-600"> {m.ratio}</b>}</span>)}</div>
                    ) : <span className="text-xs font-medium text-amber-600">No users yet. Rule is skipped.</span>}
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Switch on={r.active} label={`${r.name} ${r.active ? "on" : "off"}`} disabled={pending} onChange={(v) => run(() => setRouteRuleActive(r.id, v))} />
                      <span className={`badge ${r.active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{r.active ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-1.5">
                      <IconBtn icon="user" tone="sky" label="Users of this rule" onClick={() => setOpenId(r.id)} />
                      <IconBtn icon="pencil" tone="slate" label="Edit rule" onClick={() => setEditId(r.id)} />
                      <IconBtn icon="trash" tone="red" label="Delete rule" disabled={pending}
                        onClick={() => window.confirm(`Delete rule ${r.name}? Already assigned leads stay as they are.`) && run(() => deleteRouteRule(r.id))} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rules.length && <div className="px-4 py-6 text-center text-sm text-slate-500">No routing rules yet. Optional: e.g. &quot;Hindi leads → Neha, Rahul&quot; or &quot;Kitchen leads → kitchen team by workload&quot;.</div>}
      </div>
      {current && (
        <DetailsModal row={{ id: current.id, sourceId: null, name: current.name, active: current.active, waiting: 0, cities: null }}
          members={members.filter((m) => m.allocId === current.id)} users={users} onClose={() => setOpenId(null)} api={ROUTE_API}
          empty="No users yet. Until you add one, this rule is skipped."
          hint={`Leads matching "${matchText(current)}" go to these users ${current.mode === "least_load"
            ? "by workload: the user with the fewest open leads gets the next one (ratio is not used)"
            : "in turns by ratio"}. Max / day, away, outside working hours, auto-allocation off or open-lead limit reached = skipped. If nobody can take it, the next rule, then the city / source lists are tried.`} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ first-reply SLA
export type SlaSettings = { enabled: boolean; minutes: number; maxReassign: number; notify: boolean };
export type SlaLogRow = { id: string; at: string; leadId: string; leadNo: number | null; action: "reassigned" | "alerted" | "unassigned"; from: string | null; to: string | null; waited: number | null };

export function ReplySlaCard({ sla, log, autoAllocate }: { sla: SlaSettings; log: SlaLogRow[]; autoAllocate: boolean }) {
  const [enabled, setEnabled] = useState(sla.enabled);
  const [minutes, setMinutes] = useState(String(sla.minutes));
  const [maxRe, setMaxRe] = useState(String(sla.maxReassign));
  const [notify, setNotify] = useState(sla.notify);
  const { pending, msg, run } = useRun();
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="card mb-4 overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-red-50 text-red-600"><Icon name="clock" className="h-3.5 w-3.5" /></span>
          First-reply SLA
          <span className={`badge ${sla.enabled ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{sla.enabled ? "On" : "Off"}</span>
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          If the owner of a new lead does not reply in time (WhatsApp reply, call, note, status change or follow-up), the lead moves to the next
          free user through the same rules / lists above (never back to someone who already missed it), and the owner, team leader and admins get an alert.
          After the last reassignment only alerts are sent. Only leads that come in after you switch this on are checked.
        </p>
      </div>
      <div className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[auto_1fr_1fr_auto_auto]">
        <div className="flex items-center gap-2 pb-2">
          <Switch on={enabled} label={`First-reply SLA ${enabled ? "on" : "off"}`} onChange={setEnabled} />
          <span className="text-sm font-medium text-navy-900">{enabled ? "On" : "Off"}</span>
        </div>
        <label className="block"><span className="label">No reply within (minutes)</span><input className="input" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
        <label className="block"><span className="label">Reassign at most (times)</span><input className="input" type="number" min={0} max={10} value={maxRe} onChange={(e) => setMaxRe(e.target.value)} title="0 = only alert, never reassign" /></label>
        <label className="flex items-center gap-2 pb-2 text-sm text-navy-900"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Alert managers</label>
        <button type="button" className="btn-primary" disabled={pending} onClick={() => run(() => saveReplySla({ enabled, minutes, maxReassign: maxRe, notify }))}>Save</button>
      </div>
      <div className="space-y-2 px-4 pb-3">
        <Msg msg={msg} />
        {!autoAllocate && enabled && <p className="text-xs text-amber-600">Auto-allocation is off for the company: late leads are still reassigned using your lists, but new leads are not auto-assigned on arrival.</p>}
      </div>
      <div className="overflow-x-auto border-t border-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Lead</th><th className="th">What happened</th><th className="th">Waited</th></tr></thead>
          <tbody className="divide-y">
            {log.map((g) => (
              <tr key={g.id}>
                <td className="td whitespace-nowrap text-slate-500">{fmt(g.at)}</td>
                <td className="td"><Link href={`/leads/${g.leadId}`} className="font-medium text-brand-700 hover:underline">LB-{g.leadNo ?? "?"}</Link></td>
                <td className="td">
                  {g.action === "reassigned" ? <><span className="badge bg-amber-50 text-amber-700">Reassigned</span> {g.from ?? "?"} → <b>{g.to ?? "?"}</b></>
                    : g.action === "alerted" ? <><span className="badge bg-red-50 text-red-700">Alert only</span> {g.from ?? "Owner"} has not replied; nobody else to give it to</>
                    : <><span className="badge bg-slate-100 text-slate-600">Unassigned</span> no owner and no reply</>}
                </td>
                <td className="td">{g.waited != null ? `${g.waited} min` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!log.length && <div className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet. Late leads will show here.</div>}
      </div>
    </section>
  );
}
