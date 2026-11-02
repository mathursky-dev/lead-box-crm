import Link from "next/link";
import { requireProfile, isAdmin, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel } from "@/components/kit";
import { CallsList } from "@/components/calls-list";
import { PRESETS, rangeFor, type Preset } from "@/lib/dates";
import { CALL_DIRECTIONS, fmtDuration } from "@/lib/calls";
import { CALL_SELECT, toCallRow } from "@/lib/calls-server";
import { RecordingsSwitch } from "./recordings-switch";

export const metadata = { title: "Calls" };
type SP = Record<string, string | undefined>;
const UUID = /^[0-9a-f-]{36}$/;

export default async function CallsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const admin = isAdmin(profile), manager = isManager(profile);
  const refs = await loadRefs();
  const sb = await createClient();
  const preset = (PRESETS.some((p) => p.value === sp.range) ? sp.range : "today") as Preset;
  const { from, to } = rangeFor(preset, sp.from, sp.to);
  const dir = CALL_DIRECTIONS.some((d) => d.value === sp.dir) ? sp.dir! : "";
  const user = manager && sp.user && UUID.test(sp.user) ? sp.user : manager ? "" : profile.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (q: any) => {
    q = q.eq("company_id", profile.company_id).gte("started_at", from.toISOString()).lt("started_at", to.toISOString());
    if (user) q = q.eq("user_id", user);
    return q;
  };
  const [stats, list, co] = await Promise.all([
    base(sb.from("lb_calls").select("user_id,direction,duration_sec")).limit(10000),
    (dir ? base(sb.from("lb_calls").select(CALL_SELECT)).eq("direction", dir) : base(sb.from("lb_calls").select(CALL_SELECT)))
      .order("started_at", { ascending: false }).limit(150),
    sb.from("lb_companies").select("call_recordings").eq("id", profile.company_id).maybeSingle(),
  ]);
  if (stats.error) {
    const missing = /lb_calls|schema cache/i.test(stats.error.message);
    return <><PageHeader title="Calls" icon="phone" tone="violet" /><ErrorBox message={missing ? "Call tracking is not set up yet: the database update for Calls has to be run once (Supabase SQL)." : stats.error.message} /></>;
  }
  const all = (stats.data ?? []) as { user_id: string; direction: string; duration_sec: number }[];
  const sum = (xs: typeof all) => ({
    total: xs.length, out: xs.filter((x) => x.direction === "outgoing").length, connected: xs.filter((x) => x.duration_sec > 0).length,
    missed: xs.filter((x) => x.direction === "missed").length, talk: xs.reduce((n, x) => n + x.duration_sec, 0),
  });
  const t = sum(all);
  const names = new Map(refs.users.map((u) => [u.id, u.full_name]));
  const perUser = [...new Set(all.map((x) => x.user_id))].map((id) => ({ id, name: names.get(id) ?? "User", ...sum(all.filter((x) => x.user_id === id)) }))
    .sort((a, b) => b.talk - a.talk);
  const rows = (list.data ?? []).map(toCallRow);
  const q = (patch: SP) => "/calls?" + new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-4">
      <PageHeader title="Calls" icon="phone" tone="violet" sub="Calls made and received on the Lead Box mobile app, saved on the lead automatically."
        actions={admin ? <RecordingsSwitch enabled={co.data?.call_recordings !== false} /> : undefined} />

      <form className="card flex flex-wrap items-end gap-2 p-3 text-sm" action="/calls">
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Date</span>
          <select name="range" className="input" defaultValue={preset}>{PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        {preset === "custom" && <>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">From</span><input type="date" name="from" className="input" defaultValue={sp.from} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">To</span><input type="date" name="to" className="input" defaultValue={sp.to} /></label>
        </>}
        {manager && <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">User</span>
          <select name="user" className="input" defaultValue={user}><option value="">Everyone</option>{refs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>}
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Type</span>
          <select name="dir" className="input" defaultValue={dir}><option value="">All calls</option>{CALL_DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></label>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Total calls" value={t.total} icon="phone" tone="violet" />
        <Kpi label="Outgoing" value={t.out} icon="send" tone="green" href={q({ dir: "outgoing" })} />
        <Kpi label="Connected" value={t.connected} sub={t.total ? `${Math.round((t.connected / t.total) * 100)}% of calls` : undefined} icon="check" tone="blue" />
        <Kpi label="Missed" value={t.missed} icon="alert" tone="red" href={q({ dir: "missed" })} />
        <Kpi label="Talk time" value={fmtDuration(t.talk)} sub={t.connected ? `avg ${fmtDuration(t.talk / t.connected)}` : undefined} icon="clock" tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Call log" icon="list" className="lg:col-span-2" sub={rows.length === 150 ? "Latest 150 calls" : undefined}>
          <CallsList calls={rows} showLead meId={profile.id} admin={admin} />
        </Panel>
        <div className="space-y-4">
          {manager && (
            <Panel title="By user" icon="trophy" tone="violet">
              {!perUser.length ? <p className="text-xs text-slate-500">No calls in this period.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">User</th><th>Calls</th><th>Conn.</th><th className="text-right">Talk</th></tr></thead>
                  <tbody>{perUser.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100"><td className="py-1.5"><Link href={q({ user: u.id })} className="text-brand-700 hover:underline">{u.name}</Link></td>
                      <td>{u.total}</td><td>{u.connected}</td><td className="text-right">{fmtDuration(u.talk)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Panel>
          )}
          <Panel title="How it works" icon="help" tone="slate">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
              <li>Install the Lead Box app on the phone and sign in. Allow call access once.</li>
              <li>Calls to and from numbers that are in the CRM are saved on the lead with time and duration. Personal numbers are never saved.</li>
              <li>Recordings: turn on the phone&apos;s own call recorder. The app uploads the recording after the call (Android does not let any app record calls by itself).</li>
              <li>After an outgoing call the app asks for the outcome, so the history stays complete.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
