import { requireProfile, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi } from "@/components/kit";
import { PRESETS, rangeFor, istDate, fmtClock, fmtDay, type Preset } from "@/lib/dates";
import { fmtHours, mapUrl } from "@/lib/field";
import { FieldTabs } from "../tabs";
import { CsvButton } from "../csv-button";

export const metadata = { title: "Attendance" };
type SP = Record<string, string | undefined>;
const UUID = /^[0-9a-f-]{36}$/;

type Row = { id: string; user_id: string; check_in_at: string; check_out_at: string | null; in_lat: number | null; in_lng: number | null; in_acc: number | null;
  out_lat: number | null; out_lng: number | null; in_note: string; out_note: string; synced_late: boolean };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const manager = isManager(profile);
  const refs = await loadRefs();
  const sb = await createClient();
  const nowMs = new Date().getTime();
  const preset = (PRESETS.some((p) => p.value === sp.range) ? sp.range : "today") as Preset;
  const { from, to } = rangeFor(preset, sp.from, sp.to);
  const user = manager && sp.user && UUID.test(sp.user) ? sp.user : manager ? "" : profile.id;

  let q = sb.from("lb_attendance").select("id,user_id,check_in_at,check_out_at,in_lat,in_lng,in_acc,out_lat,out_lng,in_note,out_note,synced_late")
    .eq("company_id", profile.company_id).gte("check_in_at", from.toISOString()).lt("check_in_at", to.toISOString())
    .order("check_in_at", { ascending: true }).limit(5000);
  if (user) q = q.eq("user_id", user);
  let vq = sb.from("lb_field_visits").select("user_id,started_at").eq("company_id", profile.company_id)
    .gte("started_at", from.toISOString()).lt("started_at", to.toISOString()).limit(10000);
  if (user) vq = vq.eq("user_id", user);
  const [res, vis] = await Promise.all([q, vq]);
  if (res.error) {
    const missing = /lb_attendance|schema cache/i.test(res.error.message);
    return <><FieldTabs /><ErrorBox message={missing ? "Attendance is not set up yet: the database update for Field force has to be run once (Supabase SQL)." : res.error.message} /></>;
  }
  const names = new Map(refs.users.map((u) => [u.id, u.full_name]));
  const rows = (res.data ?? []) as Row[];
  const visitCount = new Map<string, number>();
  for (const v of (vis.data ?? []) as { user_id: string; started_at: string }[]) {
    const k = `${v.user_id}|${istDate(new Date(v.started_at))}`;
    visitCount.set(k, (visitCount.get(k) ?? 0) + 1);
  }

  // One line per person per day: first in, last out, total worked.
  type Day = { key: string; user: string; day: string; first: Row; last: Row; minutes: number; sessions: number; open: boolean; late: boolean };
  const days = new Map<string, Day>();
  for (const r of rows) {
    const day = istDate(new Date(r.check_in_at));
    const key = `${r.user_id}|${day}`;
    const end = r.check_out_at ? new Date(r.check_out_at).getTime() : Math.min(nowMs, new Date(r.check_in_at).getTime() + 16 * 3600e3);
    const min = (end - new Date(r.check_in_at).getTime()) / 60000;
    const d = days.get(key);
    if (!d) days.set(key, { key, user: r.user_id, day, first: r, last: r, minutes: min, sessions: 1, open: !r.check_out_at, late: r.synced_late });
    else { d.last = r; d.minutes += min; d.sessions++; d.open = d.open || !r.check_out_at; d.late = d.late || r.synced_late; }
  }
  const list = [...days.values()].sort((a, b) => b.day.localeCompare(a.day) || (names.get(a.user) ?? "").localeCompare(names.get(b.user) ?? ""));
  const people = new Set(list.map((d) => d.user)).size;
  const todayYmd = istDate();
  const inNow = new Set(rows.filter((r) => !r.check_out_at && istDate(new Date(r.check_in_at)) === todayYmd).map((r) => r.user_id)).size;
  const totalMin = list.reduce((n, d) => n + d.minutes, 0);
  const activeUsers = refs.users.filter((u) => u.is_active).length;

  const csv = [["Date", "User", "First check-in", "Last check-out", "Hours", "Sessions", "Visits", "Check-in map", "Synced later"],
    ...list.map((d) => [d.day, names.get(d.user) ?? "", fmtClock(d.first.check_in_at), d.open ? "Still in" : fmtClock(d.last.check_out_at),
      (d.minutes / 60).toFixed(2), String(d.sessions), String(visitCount.get(d.key) ?? 0), mapUrl(d.first.in_lat, d.first.in_lng) ?? "", d.late ? "yes" : ""])];

  return (
    <div className="space-y-4">
      <FieldTabs />
      <PageHeader title="Attendance" icon="clock" tone="blue" sub="Check-in and check-out from the Field app, with GPS location. One line per person per day."
        actions={<CsvButton rows={csv} name={`attendance-${istDate()}.csv`} />} />

      <form className="card flex flex-wrap items-end gap-2 p-3 text-sm" action="/field/attendance">
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Date</span>
          <select name="range" className="input" defaultValue={preset}>{PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        {preset === "custom" && <>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">From</span><input type="date" name="from" className="input" defaultValue={sp.from} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">To</span><input type="date" name="to" className="input" defaultValue={sp.to} /></label>
        </>}
        {manager && <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">User</span>
          <select name="user" className="input" defaultValue={user}><option value="">Everyone</option>{refs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>}
        <button className="btn-primary">Apply</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Checked in now" value={inNow} sub={manager && !user ? `of ${activeUsers} users` : undefined} icon="user" tone="green" />
        <Kpi label="People present" value={people} icon="contacts" tone="blue" />
        <Kpi label="Total hours" value={fmtHours(totalMin)} icon="clock" tone="amber" />
        <Kpi label="Avg per day" value={list.length ? fmtHours(totalMin / list.length) : "—"} icon="chart" tone="violet" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
            <th className="th">Date</th><th className="th">User</th><th className="th">First in</th><th className="th">Last out</th>
            <th className="th">Worked</th><th className="th">Visits</th><th className="th">Location</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && <tr><td className="td text-slate-500" colSpan={7}>No check-ins in this period.</td></tr>}
            {list.map((d) => {
              const inMap = mapUrl(d.first.in_lat, d.first.in_lng), outMap = mapUrl(d.last.out_lat, d.last.out_lng);
              return (
                <tr key={d.key}>
                  <td className="td whitespace-nowrap">{fmtDay(d.first.check_in_at)}</td>
                  <td className="td font-medium text-navy-900">{names.get(d.user) ?? "User"}</td>
                  <td className="td whitespace-nowrap">{fmtClock(d.first.check_in_at)}{d.first.in_note && <div className="text-xs text-slate-500">{d.first.in_note}</div>}</td>
                  <td className="td whitespace-nowrap">{d.open ? <span className="badge bg-emerald-100 text-emerald-800">Still in</span> : fmtClock(d.last.check_out_at)}</td>
                  <td className="td whitespace-nowrap">{fmtHours(d.minutes)}{d.sessions > 1 && <span className="text-xs text-slate-400"> · {d.sessions} sessions</span>}</td>
                  <td className="td">{visitCount.get(d.key) ?? 0}</td>
                  <td className="td whitespace-nowrap text-xs">
                    {inMap ? <a className="text-brand-700 underline" href={inMap} target="_blank" rel="noreferrer">In map</a> : <span className="text-slate-400">No GPS</span>}
                    {outMap && <> · <a className="text-brand-700 underline" href={outMap} target="_blank" rel="noreferrer">Out map</a></>}
                    {d.late && <span className="ml-1 badge bg-slate-100 text-slate-600" title="Saved offline on the phone and synced later">offline</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
