import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox, PageHeader } from "@/components/static";
import { Icon, Kpi, PillTabs } from "@/components/kit";
import { fmtClock, istDate } from "@/lib/dates";

export const metadata = { title: "Login hours" };
export const dynamic = "force-dynamic";

type User = { user_id: string; name: string; role: string; team: string | null };
type Day = { user_id: string; day: string; login_at: string | null; first_seen_at: string | null; last_seen_at: string | null; logout_at: string | null;
  logins: number; active_min: number; gps_in: string | null; gps_out: string | null; gps_open: boolean };

const DAY = 86400000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd: string, n: number) => new Date(new Date(ymd + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);
const hrs = (m: number) => (m <= 0 ? "—" : m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
const dayLabel = (ymd: string) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shiftMonth = (ym: string, by: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
/** Minutes after IST midnight, for averaging clock times. */
const istMin = (iso: string) => { const d = new Date(new Date(iso).getTime() + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const clock = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); const d = new Date(Date.UTC(2000, 0, 1, h, m)); return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }); };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const roleLabel = (u: User) => [u.team, u.role === "team_leader" ? "Team leader" : u.role === "agent" ? "Agent" : "Admin"].filter(Boolean).join(" · ");

export default async function LoginHoursPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireProfile();
  const today = istDate();
  const view = sp.view === "month" ? "month" : "day";
  const day = YMD.test(sp.day ?? "") && sp.day! <= today ? sp.day! : today;
  const ym = /^\d{4}-\d{2}$/.test(sp.month ?? "") && sp.month! <= today.slice(0, 7) ? sp.month! : today.slice(0, 7);
  const from = view === "day" ? day : `${ym}-01`;
  const to = view === "day" ? day : (() => { const last = addDays(`${shiftMonth(ym, 1)}-01`, -1); return last > today ? today : last; })();

  const { data, error } = await (await createClient()).rpc("lb_team_login", { p_from: from, p_to: to });
  const res = data as { users: User[]; days: Day[]; now: string } | null;
  const now = res ? new Date(res.now).getTime() : 0;

  const tabs = [
    { href: `/login-hours?view=day&day=${day}`, label: "Day", icon: "calendar", active: view === "day" },
    { href: `/login-hours?view=month&month=${ym}`, label: "Month", icon: "chart", active: view === "month" },
  ];
  const nav = view === "day" ? (
    <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm">
      <Link href={`/login-hours?view=day&day=${addDays(day, -1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Previous day">‹</Link>
      <span className="min-w-32 text-center font-semibold text-navy-900">{day === today ? "Today" : dayLabel(day)}</span>
      {day < today ? <Link href={`/login-hours?view=day&day=${addDays(day, 1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Next day">›</Link> : <span className="px-2 py-1 text-slate-300">›</span>}
    </div>
  ) : (
    <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm">
      <Link href={`/login-hours?view=month&month=${shiftMonth(ym, -1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Previous month">‹</Link>
      <span className="min-w-32 text-center font-semibold text-navy-900">{monthLabel(ym)}</span>
      {ym < today.slice(0, 7) ? <Link href={`/login-hours?view=month&month=${shiftMonth(ym, 1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Next month">›</Link> : <span className="px-2 py-1 text-slate-300">›</span>}
    </div>
  );

  return (
    <>
      <PageHeader icon="clock" tone="blue" title="Login hours"
        sub="Daily CRM login and logout time for each agent, time active on the CRM, and Field app GPS check-in. Times in IST."
        actions={nav} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PillTabs tabs={tabs} label="View" />
        <Link href="/targets" className="btn-ghost btn-sm"><Icon name="target" className="h-3.5 w-3.5" /> Targets</Link>
      </div>
      {error || !res ? (
        <ErrorBox message={error?.message.includes("lb_team_login") ? "Login hours are not set up in the database yet (run the agent login SQL)." : error?.message ?? "Could not load login hours"} />
      ) : view === "day" ? <DayView users={res.users} days={res.days} now={now} isToday={day === today} /> : <MonthView users={res.users} days={res.days} from={from} to={to} />}
      <p className="mt-3 text-xs text-slate-500">
        Login = first sign-in of the day (or first time the CRM was opened if the user stayed signed in). Last active = last time the CRM was open on screen.
        Active time counts only while the CRM is open and visible. GPS check-in comes from the Field app.
      </p>
    </>
  );
}

function DayView({ users, days, now, isToday }: { users: User[]; days: Day[]; now: number; isToday: boolean }) {
  const byUser = new Map(days.map((d) => [d.user_id, d]));
  const online = (d?: Day) => !!d && isToday && !d.logout_at && !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() < 5 * 60000;
  const present = users.filter((u) => byUser.has(u.user_id));
  const onlineN = users.filter((u) => online(byUser.get(u.user_id))).length;
  const logins = present.map((u) => byUser.get(u.user_id)!).filter((d) => d.login_at).map((d) => istMin(d.login_at!));
  const totalMin = present.reduce((a, u) => a + Number(byUser.get(u.user_id)?.active_min ?? 0), 0);
  const list = [...users].sort((a, b) => {
    const da = byUser.get(a.user_id), db = byUser.get(b.user_id);
    if (!!da !== !!db) return da ? -1 : 1;
    return (da?.login_at ?? "").localeCompare(db?.login_at ?? "") || a.name.localeCompare(b.name);
  });

  return (
    <>
      {users.length > 1 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Logged in" value={`${present.length} / ${users.length}`} sub={`${users.length - present.length} not seen`} icon="user" tone="green" />
          {isToday ? <Kpi label="Online now" value={onlineN} sub="CRM open in the last 5 min" icon="activity" tone="blue" /> : <Kpi label="Active (total)" value={hrs(totalMin)} sub="All users together" icon="activity" tone="blue" />}
          <Kpi label="Average login" value={avg(logins) != null ? clock(avg(logins)!) : "—"} sub="First sign-in of the day" icon="clock" tone="violet" />
          <Kpi label="Average active" value={present.length ? hrs(totalMin / present.length) : "—"} sub="Per user who logged in" icon="chart" tone="amber" />
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">User</th><th className="th">Status</th><th className="th">Login</th><th className="th">Last active</th><th className="th">Logout</th>
              <th className="th text-right">Active time</th><th className="th text-right">Sign-ins</th><th className="th">GPS check-in / out</th></tr>
          </thead>
          <tbody className="divide-y">
            {list.map((u) => {
              const d = byUser.get(u.user_id);
              const on = online(d);
              const status = !d ? { t: "Not logged in", c: "bg-slate-100 text-slate-500" }
                : on ? { t: "Online", c: "bg-emerald-50 text-emerald-700" }
                : d.logout_at ? { t: "Logged out", c: "bg-slate-100 text-navy-800" }
                : { t: isToday ? "Away" : "Present", c: "bg-sky-50 text-sky-700" };
              return (
                <tr key={u.user_id} className="hover:bg-slate-50">
                  <td className="td"><div className="font-medium text-navy-900">{u.name}</div><div className="text-xs text-slate-500">{roleLabel(u)}</div></td>
                  <td className="td"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${status.c}`}>{on && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{status.t}</span></td>
                  <td className="td font-medium text-navy-900">{d?.login_at ? fmtClock(d.login_at) : "—"}</td>
                  <td className="td">{d?.last_seen_at ? fmtClock(d.last_seen_at) : "—"}</td>
                  <td className="td">{d?.logout_at ? fmtClock(d.logout_at) : d ? <span className="text-xs text-slate-400">{isToday ? "still signed in" : "did not log out"}</span> : "—"}</td>
                  <td className="td text-right font-semibold text-navy-900">{d ? hrs(Number(d.active_min)) : "—"}</td>
                  <td className="td text-right">{d?.logins || "—"}</td>
                  <td className="td text-xs">{d?.gps_in ? <>{fmtClock(d.gps_in)} – {d.gps_out ? fmtClock(d.gps_out) : d.gps_open ? <span className="text-emerald-700">on duty</span> : "—"}</> : <span className="text-slate-400">—</span>}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td className="td text-slate-500" colSpan={8}>No users to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MonthView({ users, days, from, to }: { users: User[]; days: Day[]; from: string; to: string }) {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const key = (u: string, d: string) => `${u}|${d}`;
  const map = new Map(days.map((d) => [key(d.user_id, d.day), d]));
  const rows = users.map((u) => {
    const mine = days.filter((d) => d.user_id === u.user_id && (d.login_at || d.last_seen_at));
    const active = mine.reduce((a, d) => a + Number(d.active_min), 0);
    return {
      u, mine, active,
      avgIn: avg(mine.filter((d) => d.login_at).map((d) => istMin(d.login_at!))),
      avgOut: avg(mine.map((d) => d.logout_at ?? d.last_seen_at).filter(Boolean).map((v) => istMin(v!))),
    };
  }).sort((a, b) => b.active - a.active || a.u.name.localeCompare(b.u.name));
  const cell = (m: number) => (m <= 0 ? "bg-slate-100" : m < 60 ? "bg-brand-100" : m < 180 ? "bg-brand-400" : m < 360 ? "bg-brand-500" : "bg-brand-700");

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr><th className="th">User</th><th className="th text-right">Days</th><th className="th">Avg login</th><th className="th">Avg logout</th>
            <th className="th text-right">Active total</th><th className="th text-right">Per day</th><th className="th">Day by day (active time)</th></tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ u, mine, active, avgIn, avgOut }) => (
            <tr key={u.user_id} className="hover:bg-slate-50">
              <td className="td"><div className="font-medium text-navy-900">{u.name}</div><div className="text-xs text-slate-500">{roleLabel(u)}</div></td>
              <td className="td text-right font-semibold text-navy-900">{mine.length}<span className="text-xs font-normal text-slate-400"> / {dates.length}</span></td>
              <td className="td">{avgIn != null ? clock(avgIn) : "—"}</td>
              <td className="td">{avgOut != null ? clock(avgOut) : "—"}</td>
              <td className="td text-right font-semibold text-navy-900">{hrs(active)}</td>
              <td className="td text-right">{mine.length ? hrs(active / mine.length) : "—"}</td>
              <td className="td">
                <div className="flex gap-0.5">
                  {dates.map((d) => {
                    const x = map.get(key(u.user_id, d));
                    const tip = `${dayLabel(d)}: ${x ? `login ${x.login_at ? fmtClock(x.login_at) : "—"}, last ${fmtClock(x.logout_at ?? x.last_seen_at)}, active ${hrs(Number(x.active_min))}${x.gps_in ? `, GPS in ${fmtClock(x.gps_in)}` : ""}` : "not logged in"}`;
                    return <Link key={d} href={`/login-hours?view=day&day=${d}`} title={tip} aria-label={tip}
                      className={`h-5 w-2.5 rounded-sm ${x ? cell(Number(x.active_min) || 1) : "bg-slate-100"} ${x?.gps_in ? "ring-1 ring-sky-400" : ""}`} />;
                  })}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td className="td text-slate-500" colSpan={7}>No users to show.</td></tr>}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="h-3 w-2.5 rounded-sm bg-slate-100" /> not logged in</span>
        <span className="flex items-center gap-1"><span className="h-3 w-2.5 rounded-sm bg-brand-100" /> &lt; 1h</span>
        <span className="flex items-center gap-1"><span className="h-3 w-2.5 rounded-sm bg-brand-400" /> 1–3h</span>
        <span className="flex items-center gap-1"><span className="h-3 w-2.5 rounded-sm bg-brand-500" /> 3–6h</span>
        <span className="flex items-center gap-1"><span className="h-3 w-2.5 rounded-sm bg-brand-700" /> 6h+</span>
        <span className="flex items-center gap-1"><span className="h-3 w-2.5 rounded-sm bg-slate-100 ring-1 ring-sky-400" /> GPS check-in</span>
      </div>
    </div>
  );
}
