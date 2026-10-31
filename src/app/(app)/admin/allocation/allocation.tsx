"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, TILE } from "@/components/kit";
import {
  addAllocSource, setAllocSourceActive, deleteAllocSource, assignWaiting,
  addAllocMember, updateAllocMember, setAllocMemberActive, deleteAllocMember,
} from "@/lib/actions/allocation";

export type AllocRow = { id: string; sourceId: string | null; name: string; active: boolean; waiting: number };
export type MemberRow = { id: string; allocId: string; userId: string; ratio: number; maxPerDay: number | null; active: boolean; today: number; total: number };
export type UserLite = { id: string; name: string; active: boolean; open: number; block: string | null };
type Res = { error?: string; ok?: string };

/** Runs a server action, refreshes the page and keeps the last message for display. */
function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Res>();
  const router = useRouter();
  const run = (fn: () => Promise<Res>, after?: (r: Res) => void) => start(async () => {
    const r = await fn();
    setMsg(r);
    if (!r.error) { router.refresh(); after?.(r); }
  });
  return { pending, msg, setMsg, run };
}

function Msg({ msg }: { msg?: Res }) {
  if (!msg?.error && !msg?.ok) return null;
  return <div role={msg.error ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${msg.error ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{msg.error ?? msg.ok}</div>;
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? "bg-brand-600" : "bg-slate-300"}`}>
      <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function IconBtn({ icon, label, tone, onClick, disabled }: { icon: string; label: string; tone: "sky" | "red" | "violet" | "slate"; onClick: () => void; disabled?: boolean }) {
  const c = { sky: "bg-sky-500 hover:bg-sky-600", red: "bg-red-500 hover:bg-red-600", violet: "bg-violet-500 hover:bg-violet-600", slate: "bg-slate-400 hover:bg-slate-500" }[tone];
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-full text-white shadow-sm transition disabled:opacity-50 ${c}`}>
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

// ------------------------------------------------------------------ source list
export function AllocationBoard({ rows, members, users, addable }: { rows: AllocRow[]; members: MemberRow[]; users: UserLite[]; addable: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { pending, msg, run } = useRun();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const list = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const current = rows.find((r) => r.id === openId) ?? null;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-violet-50 text-violet-600"><Icon name="contacts" className="h-3.5 w-3.5" /></span>
          Lead Allocations
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-navy-900" htmlFor="alloc-source">Source</label>
          <select id="alloc-source" className="input w-52 py-1.5" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{addable.length ? "Select source" : "All sources added"}</option>
            {addable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" className="btn-primary py-1.5" disabled={!pick || pending}
            onClick={() => run(() => addAllocSource(pick), () => setPick(""))}>
            <Icon name="plus" className="h-4 w-4" /> Add
          </button>
          <button type="button" className="btn-navy px-2.5 py-1.5" aria-label="Refresh" title="Refresh" disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}>
            <Icon name="refresh" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="space-y-2 px-4 pt-3">
        <label className="relative block max-w-md">
          <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-slate-400"><Icon name="search" /></span>
          <input className="input pl-9" placeholder="Source Name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search source" />
        </label>
        <Msg msg={msg} />
      </div>

      <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Source Name</th><th className="th">Users · ratio</th><th className="th">Waiting</th><th className="th">Status</th><th className="th">Actions</th></tr></thead>
          <tbody className="divide-y">
            {list.map((r) => {
              const ms = members.filter((m) => m.allocId === r.id);
              const on = ms.filter((m) => m.active);
              return (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="td font-medium text-navy-900">
                    <button type="button" className="hover:text-brand-700 hover:underline" onClick={() => setOpenId(r.id)}>{r.name}</button>
                    {r.sourceId === null && <div className="text-xs font-normal text-slate-500">Leads from sources not listed above</div>}
                  </td>
                  <td className="td">
                    {on.length ? (
                      <div className="flex flex-wrap gap-1">
                        {on.map((m) => <span key={m.id} className="badge bg-slate-100 text-navy-800">{userName.get(m.userId) ?? "?"} <b className="text-violet-600">{m.ratio}</b></span>)}
                      </div>
                    ) : <span className="text-xs font-medium text-amber-600">No users yet. Leads stay unassigned.</span>}
                  </td>
                  <td className="td">{r.waiting ? <span className="badge bg-amber-50 text-amber-700">{r.waiting} unassigned</span> : <span className="text-slate-400">0</span>}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Switch on={r.active} label={`${r.name} allocation ${r.active ? "on" : "off"}`} disabled={pending} onChange={(v) => run(() => setAllocSourceActive(r.id, v))} />
                      <span className={`badge ${r.active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{r.active ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-1.5">
                      <IconBtn icon="user" tone="sky" label="Users, ratio and max per day" onClick={() => setOpenId(r.id)} />
                      {r.waiting > 0 && r.active && on.length > 0 && (
                        <IconBtn icon="send" tone="violet" label={`Assign ${r.waiting} waiting lead(s) now`} disabled={pending}
                          onClick={() => window.confirm(`Assign ${r.waiting} unassigned ${r.name} lead(s) now by ratio and max per day?`) && run(() => assignWaiting(r.id))} />
                      )}
                      <IconBtn icon="trash" tone="red" label="Remove source from allocation" disabled={pending}
                        onClick={() => window.confirm(`Remove ${r.name} from allocation? Its user list is deleted; already assigned leads stay as they are.`) && run(() => deleteAllocSource(r.id))} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            {rows.length ? "No source matches your search." : "No sources yet. Pick a source above and press Add, then add users to it."}
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-semibold text-navy-900">{list.length} record{list.length === 1 ? "" : "s"}</div>

      {current && <DetailsModal row={current} members={members.filter((m) => m.allocId === current.id)} users={users} onClose={() => setOpenId(null)} />}
    </section>
  );
}

// ------------------------------------------------------------------ details modal
function UserPicker({ users, value, onChange }: { users: UserLite[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const sel = users.find((u) => u.id === value);
  const list = users.filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <span className="label">User</span>
      <button type="button" className="input flex items-center justify-between text-left" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={sel ? "text-navy-900" : "text-slate-400"}>{sel?.name ?? "Select User"}</span>
        <Icon name="chevronDown" className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 bg-slate-50 p-2">
            <input autoFocus className="input py-1.5" placeholder="Search user" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search user" />
          </div>
          <ul role="listbox" className="max-h-56 overflow-auto py-1">
            {list.map((u) => (
              <li key={u.id}>
                <button type="button" role="option" aria-selected={u.id === value} className="block w-full px-3 py-1.5 text-left text-sm text-navy-900 hover:bg-brand-50"
                  onClick={() => { onChange(u.id); setOpen(false); setQ(""); }}>
                  {u.name}{u.block && <span className="ml-1 text-xs text-amber-600">· {u.block}</span>}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-3 py-2 text-sm text-slate-500">{users.length ? "No match" : "Every user is already added"}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function MemberLine({ m, user, share, pending, run }: { m: MemberRow; user?: UserLite; share: number | null; pending: boolean; run: ReturnType<typeof useRun>["run"] }) {
  const [edit, setEdit] = useState(false);
  const [ratio, setRatio] = useState(String(m.ratio));
  const [max, setMax] = useState(m.maxPerDay ? String(m.maxPerDay) : "");
  const full = m.maxPerDay != null && m.today >= m.maxPerDay;
  const warn = !m.active ? null : user?.block ?? (full ? "Today's max reached; gets leads again tomorrow" : null);
  return (
    <tr className={m.active ? "" : "bg-slate-50/70 text-slate-400"}>
      <td className="td">
        <div className={`font-medium ${m.active ? "text-navy-900" : "text-slate-400"}`}>{user?.name ?? "Deleted user"}</div>
        {warn && <div className="text-xs text-amber-600">{warn}</div>}
      </td>
      <td className="td">{edit ? <input className="input w-20 py-1" type="number" min={1} max={100} value={ratio} onChange={(e) => setRatio(e.target.value)} aria-label="Ratio" /> : m.ratio}</td>
      <td className="td">{share == null ? "-" : `${share}%`}</td>
      <td className="td">{edit ? <input className="input w-24 py-1" type="number" min={1} placeholder="No limit" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Max per day" /> : m.maxPerDay ?? "-"}</td>
      <td className="td">{m.today}{m.maxPerDay ? <span className="text-slate-400"> / {m.maxPerDay}</span> : null}</td>
      <td className="td">
        <div className="flex items-center gap-1.5">
          {edit ? (
            <>
              <button type="button" className="btn-primary btn-sm" disabled={pending} onClick={() => run(() => updateAllocMember(m.id, { ratio, maxPerDay: max }), () => setEdit(false))}>Save</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setEdit(false); setRatio(String(m.ratio)); setMax(m.maxPerDay ? String(m.maxPerDay) : ""); }}>Cancel</button>
            </>
          ) : (
            <>
              <Switch on={m.active} label={`${user?.name ?? "User"} ${m.active ? "on" : "off"}`} disabled={pending} onChange={(v) => run(() => setAllocMemberActive(m.id, v))} />
              <IconBtn icon="pencil" tone="sky" label="Edit ratio and max per day" onClick={() => setEdit(true)} />
              <IconBtn icon="trash" tone="red" label="Remove user" disabled={pending}
                onClick={() => window.confirm(`Remove ${user?.name ?? "this user"} from this source?`) && run(() => deleteAllocMember(m.id))} />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function DetailsModal({ row, members, users, onClose }: { row: AllocRow; members: MemberRow[]; users: UserLite[]; onClose: () => void }) {
  const [userId, setUserId] = useState("");
  const [ratio, setRatio] = useState("1");
  const [max, setMax] = useState("");
  const { pending, msg, run } = useRun();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const taken = new Set(members.map((m) => m.userId));
  const choices = users.filter((u) => u.active && !taken.has(u.id));
  const canTake = (m: MemberRow) => m.active && !byId.get(m.userId)?.block && !(m.maxPerDay != null && m.today >= m.maxPerDay);
  const live = members.filter(canTake);
  const sum = live.reduce((s, m) => s + m.ratio, 0);
  const example = live.length > 1 ? live.map((m) => `${byId.get(m.userId)?.name} ${m.ratio}`).join(", ") : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={`Allocation details: ${row.name}`} onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-auto rounded-t-xl bg-white shadow-xl sm:max-w-4xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className={`grid h-10 w-10 place-items-center rounded-lg ${TILE.violet}`}><Icon name="contacts" className="h-5 w-5" /></span>
            <div>
              <h2 className="text-base font-semibold text-navy-900">Allocation Details</h2>
              <p className="text-xs text-slate-500">{row.name}{!row.active && " · switched off"}</p>
            </div>
          </div>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="space-y-3 p-5">
          <div className="grid items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
            <UserPicker users={choices} value={userId} onChange={setUserId} />
            <label className="block"><span className="label">Ratio</span><input className="input" type="number" min={1} max={100} value={ratio} onChange={(e) => setRatio(e.target.value)} /></label>
            <label className="block"><span className="label">Max / day</span><input className="input" type="number" min={1} placeholder="No limit" value={max} onChange={(e) => setMax(e.target.value)} /></label>
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={!userId || pending}
                onClick={() => run(() => addAllocMember(row.id, { userId, ratio, maxPerDay: max }), () => { setUserId(""); setRatio("1"); setMax(""); })}>
                <Icon name="plus" className="h-4 w-4" /> Add
              </button>
              <button type="button" className="btn-navy px-2.5" aria-label="Refresh" title="Refresh" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
                <Icon name="refresh" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <Msg msg={msg} />

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">User</th><th className="th">Ratio</th><th className="th">Share</th><th className="th">Max / day</th><th className="th">Today</th><th className="th">Actions</th></tr></thead>
              <tbody className="divide-y">
                {members.map((m) => {
                  const ok = canTake(m);
                  return <MemberLine key={`${m.id}-${m.ratio}-${m.maxPerDay}`} m={m} user={byId.get(m.userId)} share={ok && sum ? Math.round((m.ratio / sum) * 100) : null} pending={pending} run={run} />;
                })}
              </tbody>
            </table>
            {!members.length && <div className="px-4 py-6 text-center text-sm text-slate-500">No users yet. Until you add one, {row.name} leads stay unassigned.</div>}
          </div>

          <p className="text-xs text-slate-500">
            New {row.name} leads go to these users in turns by ratio{example ? ` (${example}: out of every ${sum} leads each gets their ratio)` : ""}.
            A user who reaches their max for the day is skipped until tomorrow (IST). Users who are switched off, away, outside working hours,
            opted out of auto-allocation or at their open-lead limit are skipped too. If nobody can take a lead, it stays unassigned.
          </p>
        </div>
      </div>
    </div>
  );
}
